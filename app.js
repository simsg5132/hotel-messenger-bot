const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const stringSimilarity = require('string-similarity');

const app = express();
app.use(bodyParser.json());

// ===============================
// TOKENS
// ===============================
const PAGE_ACCESS_TOKEN = 'EAAMqnZAIh9TwBQhOqG3iXNNmQk61xukV8flwMxKbUtaxhVps7YoVsArTxmLWVpZC1L69Dv8CTZCl8zIoKF2JDUQLAVcgZAfwAs8ZA8mzAUHTdM2nmqy5JMOAaUY4SKHUfMnWyFZCTFL5B8nlHZCdsmnS7cDRtpwI9kvdgorJlIVLYmsxz49nqcsSaCnWTZAsCRcrSDjhZBZBNbNwZDZD';
const VERIFY_TOKEN = 'my_verify_token';

// ===============================
// SIMPLE USER MEMORY
// ===============================
const users = {};

// ===============================
// KEYWORD GROUPS
// ===============================
const roomKeywords = [
  "room","rooms","night","nights","per night","number","booking",
  "ოთახი","ოთახის","ღამე","ნომერი","ნომრის","ადამიანზე","ოთახზე",
  "otaxis","otaxi","gamis","ghamis","ghame","nomeri","nomris","otaxze","adamianze gamis"
];

const restaurantKeywords = [
  "restaurant","table","reservation","menu","food","drink",
  "კაცზე","მაგიდის","მაგიდაზე","ადამიანზე","ჯავშანი",
  "მენიუ","სასმელი","საჭმელი",
  "kacze","magidis","magida","sasmeli","sasmelis","adamianze magidis"
];

const spaKeywords = [
  "spa","sauna","pool","swimming","membership",
  "აბონიმენტი","საუნა","საუნის","საუნის ფასი","სპა","აუზი","სპის","აუზის","აუზის ფასი",
  "abonimenti","sauna","saunis","saunis pasi","spa","spis","auzi","auzis","auzis pasi"
];

const thanksKeywords = [
  "მადლობა", "გმადლობთ", "thanks", "thank you"
];

// Georgian words typed in English letters (transliterations)
const geokeysTranslit = [
  "otaxi","otaxis","gamis","ghamis","ghame","nomeri","nomris","otaxze","adamianze gamis",
  "kacze","magidis","magida","sasmeli","sasmelis","adamianze magidis",
  "abonimenti","sauna","saunis","saunis pasi","spa","spis","auzi","auzis","auzis pasi"
];

// ===============================
// UTILITY FUNCTIONS
// ===============================
function containsKeyword(message, keywords) {
  message = message.toLowerCase();
  return keywords.some(keyword => {
    const similarity = stringSimilarity.compareTwoStrings(message, keyword.toLowerCase());
    return similarity > 0.6 || message.includes(keyword.toLowerCase());
  });
}

// ===============================
// WEBHOOK VERIFICATION
// ===============================
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ===============================
// HANDLE INCOMING EVENTS
// ===============================
app.post('/webhook', async (req, res) => {
  const event = req.body.entry?.[0]?.messaging?.[0];
  if (!event) return res.sendStatus(200);

  const senderId = event.sender.id;

  // Initialize user
  if (!users[senderId]) {
    users[senderId] = {
      lang: null,
      finished: false,
      greeted: false,
      started: false
    };
  }

  const text = event.message?.text;

  // ===============================
  // FIRST MESSAGE - ASK LANGUAGE
  // ===============================
  if (!users[senderId].started) {
    users[senderId].started = true;
    await sendTextWithButtons(senderId, 'Hello Please choose a language\nგამარჯობა გთხოვთ აირჩიოთ ენა', [
      { title: 'English', payload: 'LANG_EN' },
      { title: 'ქართული', payload: 'LANG_KA' }
    ]);
    return res.sendStatus(200);
  }

  // ===============================
  // HANDLE QUICK REPLIES
  // ===============================
  if (event.message?.quick_reply) {
    const payload = event.message.quick_reply.payload;

    switch (payload) {
      case 'LANG_EN':
        users[senderId].lang = 'en';
        await sendMainMenu(senderId, 'en');
        break;

      case 'LANG_KA':
        users[senderId].lang = 'ka';
        await sendMainMenu(senderId, 'ka');
        break;

      case 'ROOM_RESERVATION':
        await sendText(senderId, users[senderId].lang === 'ka'
          ? `მოგესალმებით, ოთახების ფასებთან და ჯავშნებთან დაკავშირებული ნებისმიერი ინფორმაციის მისაღებად დაგვიკავშირდით ნომერზე:
+995 322 448 888

ან მოგვწერეთ:
AYS.Luxury@paragraphhotels.com

დამატებითი ინფორმაციის მისაღებად, ეწვიეთ ჩვენს ვებგვერდს:
https://www.marriott.com/en-us/hotels/tbslc-paragraph-freedom-square-a-luxury-collection-hotel-tbilisi/overview/`
          : `For room rates and reservations, please contact us at:
+995 322 448 888

Or email us:
AYS.Luxury@paragraphhotels.com

For more information, visit our website:
https://www.marriott.com/en-us/hotels/tbslc-paragraph-freedom-square-a-luxury-collection-hotel-tbilisi/`
        );
        await sendAfterInfoButtons(senderId, users[senderId].lang);
        break;

      case 'RESTAURANT_RESERVATION':
        await sendText(senderId, users[senderId].lang === 'ka'
          ? `მოგესალმებით, ჩვენი მენიუ შეგიძლიათ იხილოთ შემდეგ ბმულზე:
https://linktr.ee/paragraphfreedomsquaretbilisi`
          : `You can view our menu at the following link:
https://linktr.ee/paragraphfreedomsquaretbilisi`
        );
        await sendAfterInfoButtons(senderId, users[senderId].lang);
        break;

      case 'SPA_RESERVATION':
        await sendText(senderId, users[senderId].lang === 'ka'
          ? `სპას ერთდღიანი ვიზიტი:
კვირის დღეებში – 150 ₾
უქმეებზე – 220 ₾

აბონემენტები:
1 თვე – 950 ₾
3 თვე – 2565 ₾
6 თვე – 4560 ₾

აბონიმენტი მოიცავს:
• ულიმიტო ვიზიტს
• 1 პერსონალური მწვრთნელი
• 1 სპაში ვიზიტი მეგობრისთვის
• 1 სპა პროცედურა
• 12 სტუდიო ვარჯიში
• იოგა, კარდიო პილატესი, პრამა
• 15% ფასდაკლება სპა პროცედურებზე

სპა პროცედურების ჩამონათვალი:
https://linktr.ee/paragraphfreedomsquaretbilisi`
          : `One-day spa access:
Weekdays – 150 GEL
Weekends – 220 GEL

Memberships:
1 month – 950 GEL
3 months – 2565 GEL
6 months – 4560 GEL

Membership includes:
• Unlimited access
• 1 personal trainer session
• 1 spa visit for a friend
• 1 spa treatment
• 12 studio workouts
• Yoga, cardio pilates, prama
• 15% discount on spa treatments

Spa treatment list:
https://linktr.ee/paragraphfreedomsquaretbilisi`
        );
        await sendAfterInfoButtons(senderId, users[senderId].lang);
        break;

      case 'GO_BACK':
        await sendMainMenu(senderId, users[senderId].lang);
        break;

      case 'MORE_QUESTIONS':
        await sendText(senderId, users[senderId].lang === 'ka'
          ? `დამატებითი ინფორმაციის მისაღებად დაგვიკავშირდით ნომერზე:
+995 322 448 888

ან მოგვწერეთ:
AYS.Luxury@paragraphhotels.com

ან დაელოდეთ ოპერატორს`
          : `For additional information please contact us at:
+995 322 448 888

Or email us:
AYS.Luxury@paragraphhotels.com

Or wait for an operator`
        );
        break;

      case 'START_AGAIN':
        users[senderId].started = false;
        await sendText(senderId, 'Chat restarted.');
        break;
    }

    return res.sendStatus(200);
  }

  // ===============================
  // HANDLE TEXT MESSAGES AFTER LANGUAGE SELECTED
  // ===============================
  if (text) {
    const lang = users[senderId].lang;
    // THANK YOU MESSAGE
    if (containsKeyword(text, thanksKeywords)) {
      await sendText(senderId, lang === 'ka'
        ? 'მადლობა დაკავშირებისთვის'
        : 'Thank you for contacting us'
      );
      return res.sendStatus(200);
    }

    // FALLBACK IF UNRECOGNIZED
    await sendText(senderId, lang === 'ka'
      ? `დამატებითი ინფორმაციის მისაღებად დაგვიკავშირდით ნომერზე:
+995 322 448 888

ან მოგვწერეთ:
AYS.Luxury@paragraphhotels.com

ან დაელოდეთ ოპერატორს`
      : `For additional information please contact us at:
+995 322 448 888

Or email us:
AYS.Luxury@paragraphhotels.com

Or wait for an operator`
    );
  }

  res.sendStatus(200);
});

// ===============================
// SEND TEXT
// ===============================
async function sendText(senderId, text) {
  await axios.post(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      recipient: { id: senderId },
      message: { text }
    }
  );
}

// ===============================
// SEND TEXT WITH BUTTONS
// ===============================
async function sendTextWithButtons(senderId, text, buttons) {
  await axios.post(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      recipient: { id: senderId },
      message: {
        text,
        quick_replies: buttons.map(btn => ({ content_type: 'text', title: btn.title, payload: btn.payload }))
      }
    }
  );
}

// ===============================
// MAIN MENU
// ===============================
async function sendMainMenu(senderId, lang) {
  await sendTextWithButtons(senderId,
    lang === 'ka' ? 'რით შემიძლია დაგეხმაროთ?' : 'How can I help you?',
    [
      { title: lang === 'ka' ? 'ოთახის რეზერვაცია' : 'Room', payload: 'ROOM_RESERVATION' },
      { title: lang === 'ka' ? 'რესტორნის რეზერვაცია' : 'Restaurant', payload: 'RESTAURANT_RESERVATION' },
      { title: lang === 'ka' ? 'სპას რეზერვაცია' : 'Spa', payload: 'SPA_RESERVATION' }
    ]
  );
}

// ===============================
// AFTER INFO BUTTONS
// ===============================
async function sendAfterInfoButtons(senderId, lang) {
  await sendTextWithButtons(senderId,
    lang === 'ka' ? 'გსურთ კიდევ რამე?' : 'Would you like anything else?',
    [
      { title: lang === 'ka' ? 'უკან' : 'Go Back', payload: 'GO_BACK' },
      { title: lang === 'ka' ? 'კიდევ მაქვს კითხვა' : 'I have more questions', payload: 'MORE_QUESTIONS' }
    ]
  );
}

// ===============================
app.listen(3000, () => {
  console.log('Messenger bot running on port 3000');
});
