const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const stringSimilarity = require('string-similarity');

const app = express();
app.use(bodyParser.json());

// ===============================
// TOKENS
// ===============================
const PAGE_ACCESS_TOKEN = 'YOUR_PAGE_ACCESS_TOKEN';
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

function detectLanguage(text) {
  const isGeorgian = /[ა-ჰ]/.test(text);
  const isTranslit = geokeysTranslit.some(k => text.toLowerCase().includes(k));
  return isGeorgian || isTranslit ? 'ka' : 'en';
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
// RESET USER AFTER INACTIVITY
// ===============================
function resetRestartTimer(senderId) {
  if (!users[senderId]) return;
  if (users[senderId].restartTimeout) clearTimeout(users[senderId].restartTimeout);

  users[senderId].restartTimeout = setTimeout(async () => {
    users[senderId] = { lang: null, finished: false, greeted: false };
    await sendText(senderId, "The chat session has expired. Please press Start to begin again.\nჩატი ამოიწურა. გთხოვთ დაიწყოთ თავიდან.");
  }, 180000); // 3 minutes
}

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
      restartTimeout: null
    };
  }

  resetRestartTimer(senderId); // Reset inactivity timer

  // Handle Get Started button
  if (event.postback && event.postback.payload === "START_CHAT") {
    users[senderId] = { lang: null, finished: false, greeted: false, restartTimeout: null };
    await sendText(senderId, "Hello! Please choose a language\nგამარჯობა! გთხოვთ აირჩიოთ ენა");
    await sendLanguageButtons(senderId);
    return res.sendStatus(200);
  }

  const text = event.message?.text;

  // ===============================
  // QUICK REPLIES
  // ===============================
  if (event.message?.quick_reply) {
    const payload = event.message.quick_reply.payload;
    switch(payload) {
      case 'LANG_EN':
        users[senderId].lang = 'en';
        await sendText(senderId, `Hello! How can I help you?`);
        await sendMainMenu(senderId, 'en');
        break;
      case 'LANG_KA':
        users[senderId].lang = 'ka';
        await sendText(senderId, `გამარჯობა! რით შემიძლია დაგეხმაროთ?`);
        await sendMainMenu(senderId, 'ka');
        break;
      case 'ROOM_RESERVATION':
      case 'SPA_RESERVATION':
      case 'RESTAURANT_RESERVATION':
        await handleKeyword(senderId, payload);
        break;
      case 'GO_BACK':
        await sendMainMenu(senderId, users[senderId].lang);
        break;
      case 'MORE_QUESTIONS':
        await sendText(senderId, users[senderId].lang === 'ka' ?
          `დამატებითი ინფორმაციის მისაღებად დაგვიკავშირდით ნომერზე:
+995 322 448 888

ან მოგვწერეთ:
AYS.Luxury@paragraphhotels.com

ან დაელოდეთ ოპერატორს`
          :
          `For additional information please contact us at:
+995 322 448 888

Or email us:
AYS.Luxury@paragraphhotels.com

Or wait for an operator`
        );
        break;
      case 'START_AGAIN':
        users[senderId] = { lang: null, finished: false, greeted: false };
        await sendText(senderId, "Hello! Please choose a language\nგამარჯობა! გთხოვთ აირჩიოთ ენა");
        await sendLanguageButtons(senderId);
        break;
    }
    return res.sendStatus(200);
  }

  // ===============================
  // TEXT INPUT
  // ===============================
  if (text) {
    const lang = users[senderId].lang;
    if (!lang) return res.sendStatus(200); // ignore typing until language chosen

    // Thank you message
    if (containsKeyword(text, thanksKeywords)) {
      await sendText(senderId, lang === 'ka' ? 'მადლობა დაკავშირებისთვის' : 'Thank you for contacting us');
      return res.sendStatus(200);
    }

    await handleFreeTextKeywords(senderId, text);
    return res.sendStatus(200);
  }

  res.sendStatus(200);
});

// ===============================
// HANDLE FREE TEXT KEYWORDS
// ===============================
async function handleFreeTextKeywords(senderId, text) {
  const lang = users[senderId].lang;

  if (containsKeyword(text, roomKeywords)) {
    await sendText(senderId, lang === 'ka' ?
      `მოგესალმებით, ოთახების ფასებთან და ჯავშნებთან დაკავშირებული ნებისმიერი ინფორმაციის მისაღებად დაგვიკავშირდით ნომერზე:
+995 322 448 888

ან მოგვწერეთ:
AYS.Luxury@paragraphhotels.com

დამატებითი ინფორმაციის მისაღებად, ეწვიეთ ჩვენს ვებგვერდს:
https://www.marriott.com/en-us/hotels/tbslc-paragraph-freedom-square-a-luxury-collection-hotel-tbilisi/overview/`
      :
      `For room rates and reservations, please contact us at:
+995 322 448 888

Or email us:
AYS.Luxury@paragraphhotels.com

For more information, visit our website:
https://www.marriott.com/en-us/hotels/tbslc-paragraph-freedom-square-a-luxury-collection-hotel-tbilisi/`
    );
    await sendAfterInfoButtons(senderId, lang);
  } else if (containsKeyword(text, restaurantKeywords)) {
    await sendText(senderId, lang === 'ka' ?
      `მოგესალმებით, ჩვენი მენიუ შეგიძლიათ იხილოთ შემდეგ ბმულზე:
https://linktr.ee/paragraphfreedomsquaretbilisi`
      :
      `You can view our menu at the following link:
https://linktr.ee/paragraphfreedomsquaretbilisi`
    );
    await sendAfterInfoButtons(senderId, lang);
  } else if (containsKeyword(text, spaKeywords)) {
    await sendText(senderId, lang === 'ka' ?
      `სპას ერთდღიანი ვიზიტი:
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
      :
      `One-day spa access:
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
    await sendAfterInfoButtons(senderId, lang);
  } else {
    await sendText(senderId, lang === 'ka' ?
      `დამატებითი ინფორმაციის მისაღებად დაგვიკავშირდით ნომერზე:
+995 322 448 888

ან მოგვწერეთ:
AYS.Luxury@paragraphhotels.com

ან დაელოდეთ ოპერატორს`
      :
      `For additional information please contact us at:
+995 322 448 888

Or email us:
AYS.Luxury@paragraphhotels.com

Or wait for an operator`
    );
  }
}

// ===============================
// SEND TEXT
// ===============================
async function sendText(senderId, text) {
  await axios.post(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    { recipient: { id: senderId }, message: { text } }
  );
}

// ===============================
// LANGUAGE BUTTONS
// ===============================
async function sendLanguageButtons(senderId) {
  await axios.post(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      recipient: { id: senderId },
      message: {
        text: "Choose a language / აირჩიეთ ენა",
        quick_replies: [
          { content_type: "text", title: "English", payload: "LANG_EN" },
          { content_type: "text", title: "ქართული", payload: "LANG_KA" }
        ]
      }
    }
  );
}

// ===============================
// MAIN MENU
// ===============================
async function sendMainMenu(senderId, lang) {
  await axios.post(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      recipient: { id: senderId },
      message: {
        text: lang === 'ka' ? 'რით შემიძლია დაგეხმაროთ?' : 'How can I help you?',
        quick_replies: [
          { content_type: 'text', title: lang === 'ka' ? 'ოთახის რეზერვაცია' : 'Room reservation', payload: 'ROOM_RESERVATION' },
          { content_type: 'text', title: lang === 'ka' ? 'სპას რეზერვაცია' : 'Spa reservation', payload: 'SPA_RESERVATION' },
          { content_type: 'text', title: lang === 'ka' ? 'რესტორნის რეზერვაცია' : 'Restaurant reservation', payload: 'RESTAURANT_RESERVATION' },
          { content_type: 'text', title: lang === 'ka' ? 'კიდევ მაქვს კითხვა' : 'I have more questions', payload: 'MORE_QUESTIONS' }
        ]
      }
    }
  );
}

// ===============================
// AFTER INFO BUTTONS
// ===============================
async function sendAfterInfoButtons(senderId, lang) {
  await axios.post(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      recipient: { id: senderId },
      message: {
        text: lang === 'ka' ? 'გსურთ კიდევ რამე?' : 'Would you like anything else?',
        quick_replies: [
          { content_type: 'text', title: lang === 'ka' ? 'უკან' : 'Go back', payload: 'GO_BACK' },
          { content_type: 'text', title: lang === 'ka' ? 'კიდევ მაქვს კითხვა' : 'I have more questions', payload: 'MORE_QUESTIONS' }
        ]
      }
    }
  );
}

// ===============================
async function handleKeyword(senderId, payload) {
  if (payload === 'ROOM_RESERVATION') await handleFreeTextKeywords(senderId, "room");
  if (payload === 'SPA_RESERVATION') await handleFreeTextKeywords(senderId, "spa");
  if (payload === 'RESTAURANT_RESERVATION') await handleFreeTextKeywords(senderId, "restaurant");
}

// ===============================
app.listen(3000, () => {
  console.log('Messenger bot running on port 3000');
});
