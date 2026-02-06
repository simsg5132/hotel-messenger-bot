const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const stringSimilarity = require('string-similarity');

const app = express();
app.use(bodyParser.json());

// ===============================
// TOKENS
// ===============================
const PAGE_ACCESS_TOKEN = 'EAAMqnZAIh9TwBQmNWzwjZBiZCMvitUeYcmIMUsUD6HWyMq6RO4TOz375XqptT1pUiMhjyMfOOWqKZAVBsIvPZBi3NtajqmErrCR1Li3Kp5vI9QHOjAZCIpINIhTz0YjfGBEnoegeClUnOSe8VOC6UgutDOZBHhBUkfoULTa3TgA4QrsGHKJZBSrQfJyDJOw0zA1NwZB9yjnZAp6gZDZD';
const VERIFY_TOKEN = 'my_verify_token';

// ===============================
// SIMPLE USER MEMORY
// ===============================
const users = {};

// ===============================
// KEYWORDS
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

function isGeorgian(text) {
  return /[ა-ჰ]/.test(text);
}

function isGeorgianLikeEnglish(text) {
  text = text.toLowerCase();
  return geokeysTranslit.some(k => text.includes(k));
}

function detectLanguage(text) {
  return isGeorgian(text) || isGeorgianLikeEnglish(text) ? 'ka' : 'en';
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
      langLocked: false // NEW: language must be chosen first
    };
    await sendStartButtons(senderId); // Show start buttons immediately
    return res.sendStatus(200);
  }

  const text = event.message?.text;

  // ===============================
  // HANDLE START BUTTON
  // ===============================
  if (event.message?.quick_reply) {
    const payload = event.message.quick_reply.payload;

    switch (payload) {
      case 'START_EN':
        users[senderId].lang = 'en';
        users[senderId].langLocked = true;
        users[senderId].greeted = true;
        await sendText(senderId, 'Hello!');
        await sendMainMenu(senderId, 'en');
        return res.sendStatus(200);

      case 'START_KA':
        users[senderId].lang = 'ka';
        users[senderId].langLocked = true;
        users[senderId].greeted = true;
        await sendText(senderId, 'მოგესალმებით!');
        await sendMainMenu(senderId, 'ka');
        return res.sendStatus(200);

      case 'GO_BACK':
        await sendMainMenu(senderId, users[senderId].lang);
        return res.sendStatus(200);

      case 'MORE_QUESTIONS':
        await sendText(senderId, users[senderId].lang === 'ka'
          ? 'რით შემიძლია დაგეხმაროთ?'
          : 'How can I help you?'
        );
        await sendMainMenu(senderId, users[senderId].lang);
        return res.sendStatus(200);

      case 'START_AGAIN':
        users[senderId].langLocked = false;
        users[senderId].greeted = false;
        await sendStartButtons(senderId);
        return res.sendStatus(200);

      // You can add more payload handling here
    }
  }

  // ===============================
  // HANDLE TYPING BEFORE START
  // ===============================
  if (!users[senderId].langLocked) {
    await sendText(senderId, 'Please select a language to start the chat.\nგთხოვთ აირჩიოთ ენა დაწყებისათვის.');
    return res.sendStatus(200);
  }

  // ===============================
  // TEXT MESSAGE AFTER LANGUAGE IS LOCKED
  // ===============================
  if (text && users[senderId].langLocked) {

    // Already finished conversation
    if (users[senderId].finished) return res.sendStatus(200);

    // THANK YOU MESSAGE
    if (containsKeyword(text, thanksKeywords)) {
      await sendText(senderId, users[senderId].lang === 'ka'
        ? 'მადლობა დაკავშირებისთვის'
        : 'Thank you for contacting us'
      );
      return res.sendStatus(200);
    }

    // KEYWORD DETECTION
    if (containsKeyword(text, roomKeywords)) {
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
      return res.sendStatus(200);
    }

    if (containsKeyword(text, restaurantKeywords)) {
      await sendText(senderId, users[senderId].lang === 'ka'
        ? `მოგესალმებით, ჩვენი მენიუ შეგიძლიათ იხილოთ შემდეგ ბმულზე:
https://linktr.ee/paragraphfreedomsquaretbilisi`
        : `You can view our menu at the following link:
https://linktr.ee/paragraphfreedomsquaretbilisi`
      );
      await sendAfterInfoButtons(senderId, users[senderId].lang);
      return res.sendStatus(200);
    }

    if (containsKeyword(text, spaKeywords)) {
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
      return res.sendStatus(200);
    }

    // FALLBACK MESSAGE
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

    return res.sendStatus(200);
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
// START BUTTONS (LANGUAGE SELECTION)
async function sendStartButtons(senderId) {
  await axios.post(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      recipient: { id: senderId },
      message: {
        text: 'Please select a language / გთხოვთ აირჩიოთ ენა',
        quick_replies: [
          { content_type: 'text', title: 'Start Chat', payload: 'START_EN' },
          { content_type: 'text', title: 'აიწყე ჩათი', payload: 'START_KA' }
        ]
      }
    }
  );
}

// ===============================
// MAIN MENU
async function sendMainMenu(senderId, lang) {
  await axios.post(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${EAAMqnZAIh9TwBQmNWzwjZBiZCMvitUeYcmIMUsUD6HWyMq6RO4TOz375XqptT1pUiMhjyMfOOWqKZAVBsIvPZBi3NtajqmErrCR1Li3Kp5vI9QHOjAZCIpINIhTz0YjfGBEnoegeClUnOSe8VOC6UgutDOZBHhBUkfoULTa3TgA4QrsGHKJZBSrQfJyDJOw0zA1NwZB9yjnZAp6gZDZD}`,
    {
      recipient: { id: senderId },
      message: {
        text: lang === 'ka' ? 'რით შემიძლია დაგეხმაროთ?' : 'How can I help you?',
        quick_replies: [
          { content_type: 'text', title: lang === 'ka' ? 'ოთახის რეზერვაცია' : 'Room reservation', payload: 'ROOM_RESERVATION' },
          { content_type: 'text', title: lang === 'ka' ? 'სპას რეზერვაცია' : 'Spa reservation', payload: 'SPA_RESERVATION' },
          { content_type: 'text', title: lang === 'ka' ? 'რესტორნის რეზერვაცია' : 'Restaurant reservation', payload: 'RESTAURANT_RESERVATION' }
        ]
      }
    }
  );
}

// ===============================
// AFTER INFO BUTTONS
async function sendAfterInfoButtons(senderId, lang) {
  await axios.post(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      recipient: { id: senderId },
      message: {
        text: lang === 'ka' ? 'გსურთ კიდევ რამე?' : 'Would you like anything else?',
        quick_replies: [
          { content_type: 'text', title: lang === 'ka' ? 'უკან' : 'Go back', payload: 'GO_BACK' },
          { content_type: 'text', title: lang === 'ka' ? 'კიდევ მაქვს კითხვა' : 'I have another question', payload: 'MORE_QUESTIONS' }
        ]
      }
    }
  );
}

// ===============================
// RESTART BUTTON
async function sendRestartButton(senderId, lang) {
  await axios.post(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      recipient: { id: senderId },
      message: {
        text: lang === 'ka' ? 'გსურთ საუბრის თავიდან დაწყება?' : 'Would you like to start again?',
        quick_replies: [
          { content_type: 'text', title: lang === 'ka' ? 'თავიდან დაწყება' : 'Start again', payload: 'START_AGAIN' }
        ]
      }
    }
  );
}

// ===============================
app.listen(3000, () => {
  console.log('Messenger bot running on port 3000');
});
