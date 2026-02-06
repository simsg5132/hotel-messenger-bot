const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const stringSimilarity = require('string-similarity');

const app = express();
app.use(bodyParser.json());

// ===============================
// TOKENS
// ===============================
const PAGE_ACCESS_TOKEN = 'EAAMqnZAIh9TwBQngO1dO7gqmveDbdZAO4zPZAMCjkaYYKBmPYfF0ZBXopH2cqker7dPFzVmPUoyEJZBBSMZAjKZCqM27ZCEWNMZCOfDglizfBbBbqiXh317Xj6pnAc4ZCSJwYHMdx2kkwvjFLOJCZCPJjK4HdXlcservyodsP8iThoMwc0XvvJIYZA5ZBqdfzS3xJ3crQvQggZA1k6ZAQZDZD';
const VERIFY_TOKEN = 'my_verify_token';

// ===============================
// SIMPLE USER MEMORY
// ===============================
const users = {};

// ===============================
// KEYWORD GROUPS
// ===============================
const roomKeywords = ["room","rooms","night","nights","per night","number","booking",
  "ოთახი","ოთახის","ღამე","ნომერი","ნომრის","ადამიანზე","ოთახზე",
  "otaxis","otaxi","gamis","ghamis","ghame","nomeri","nomris","otaxze","adamianze gamis"
];

const restaurantKeywords = ["restaurant","table","reservation","menu","food","drink",
  "კაცზე","მაგიდის","მაგიდაზე","ადამიანზე","ჯავშანი",
  "მენიუ","სასმელი","საჭმელი",
  "kacze","magidis","magida","sasmeli","sasmelis","adamianze magidis"
];

const spaKeywords = ["spa","sauna","pool","swimming","membership",
  "აბონიმენტი","საუნა","საუნის","საუნის ფასი","სპა","აუზი","სპის","აუზის","აუზის ფასი",
  "abonimenti","sauna","saunis","saunis pasi","spa","spis","auzi","auzis","auzis pasi"
];

const thanksKeywords = ["მადლობა", "გმადლობთ", "thanks", "thank you"];

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

// Fetch user first name from Messenger
async function getUserName(senderId) {
  try {
    const response = await axios.get(
      `https://graph.facebook.com/${senderId}?fields=first_name&access_token=${PAGE_ACCESS_TOKEN}`
    );
    return response.data.first_name || '';
  } catch (err) {
    console.error('Error fetching user name:', err.message);
    return '';
  }
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

  // Initialize user memory
  if (!users[senderId]) {
    users[senderId] = {
      lang: null,
      finished: false,
      greeted: false,
      lastResponse: null, // prevent repeated messages
    };
  }

  const text = event.message?.text;

  // ===============================
  // QUICK REPLY HANDLING
  // ===============================
  if (event.message?.quick_reply) {
    const payload = event.message.quick_reply.payload;
    const lang = users[senderId].lang;

    switch (payload) {
      case 'LANG_EN':
        users[senderId].lang = 'en';
        await sendText(senderId, 'How can I help you?');
        await sendMainMenu(senderId, 'en');
        break;
      case 'LANG_KA':
        users[senderId].lang = 'ka';
        await sendText(senderId, 'რით შემიძლია დაგეხმაროთ?');
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
      case 'GO_BACK':
        await sendMainMenu(senderId, lang);
        break;
      case 'START_AGAIN':
        users[senderId].greeted = false;
        await sendText(senderId, users[senderId].lang === 'ka'
          ? 'გსურთ საუბრის თავიდან დაწყება?'
          : 'Would you like to start again?'
        );
        await sendRestartButton(senderId, users[senderId].lang);
        break;
    }

    return res.sendStatus(200);
  }

  // ===============================
  // TEXT MESSAGE HANDLING
  // ===============================
  if (text) {
    // Already finished conversation
    if (users[senderId].finished) return res.sendStatus(200);

    // First greeting (if not greeted yet)
    if (!users[senderId].greeted) {
      const userName = await getUserName(senderId);
      const greeting = `Hello ${userName}! Please choose a language\nგამარჯობა ${userName}! გთხოვთ აირჩიოთ ენა`;
      await sendText(senderId, greeting);
      await sendLanguageButtons(senderId);
      return res.sendStatus(200);
    }

    // Thank you keyword
    if (containsKeyword(text, thanksKeywords)) {
      const reply = users[senderId].lang === 'ka'
        ? 'მადლობა დაკავშირებისთვის'
        : 'Thank you for contacting us';
      if (users[senderId].lastResponse !== reply) {
        await sendText(senderId, reply);
        users[senderId].lastResponse = reply;
      }
      return res.sendStatus(200);
    }

    // Room / Restaurant / Spa keyword detection
    if (containsKeyword(text, roomKeywords)) {
      const reply = users[senderId].lang === 'ka'
        ? `მოგესალმებით, ოთახების ფასებთან და ჯავშნებთან დაკავშირებული ინფორმაცია:
+995 322 448 888
ან მოგვწერეთ: AYS.Luxury@paragraphhotels.com
დამატებითი ინფორმაციის მისაღებად ეწვიეთ ჩვენს ვებგვერდს:
https://www.marriott.com/en-us/hotels/tbslc-paragraph-freedom-square-a-luxury-collection-hotel-tbilisi/overview/`
        : `For room rates and reservations, contact:
+995 322 448 888
Or email: AYS.Luxury@paragraphhotels.com
For more info, visit: https://www.marriott.com/en-us/hotels/tbslc-paragraph-freedom-square-a-luxury-collection-hotel-tbilisi/`;
      if (users[senderId].lastResponse !== reply) {
        await sendText(senderId, reply);
        users[senderId].lastResponse = reply;
        await sendAfterInfoButtons(senderId, users[senderId].lang);
      }
      return res.sendStatus(200);
    }

    if (containsKeyword(text, restaurantKeywords)) {
      const reply = users[senderId].lang === 'ka'
        ? `მოგესალმებით, ჩვენი მენიუ შეგიძლიათ იხილოთ შემდეგ ბმულზე:
https://linktr.ee/paragraphfreedomsquaretbilisi`
        : `You can view our menu at: https://linktr.ee/paragraphfreedomsquaretbilisi`;
      if (users[senderId].lastResponse !== reply) {
        await sendText(senderId, reply);
        users[senderId].lastResponse = reply;
        await sendAfterInfoButtons(senderId, users[senderId].lang);
      }
      return res.sendStatus(200);
    }

    if (containsKeyword(text, spaKeywords)) {
      const reply = users[senderId].lang === 'ka'
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
https://linktr.ee/paragraphfreedomsquaretbilisi`;
      if (users[senderId].lastResponse !== reply) {
        await sendText(senderId, reply);
        users[senderId].lastResponse = reply;
        await sendAfterInfoButtons(senderId, users[senderId].lang);
      }
      return res.sendStatus(200);
    }

    // Fallback
    const fallback = users[senderId].lang === 'ka'
      ? `დამატებითი ინფორმაციის მისაღებად დაგვიკავშირდით ნომერზე:
+995 322 448 888
ან მოგვწერეთ: AYS.Luxury@paragraphhotels.com
ან დაელოდეთ ოპერატორს`
      : `For additional information contact:
+995 322 448 888
Or email: AYS.Luxury@paragraphhotels.com
Or wait for an operator`;
    if (users[senderId].lastResponse !== fallback) {
      await sendText(senderId, fallback);
      users[senderId].lastResponse = fallback;
    }
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
// LANGUAGE BUTTONS
// ===============================
async function sendLanguageButtons(senderId) {
  await axios.post(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      recipient: { id: senderId },
      message: {
        text: 'Choose a language / აირჩიეთ ენა',
        quick_replies: [
          { content_type: 'text', title: 'English', payload: 'LANG_EN' },
          { content_type: 'text', title: 'ქართული', payload: 'LANG_KA' }
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
          { content_type: 'text', title: lang === 'ka' ? 'რესტორნის რეზერვაცია' : 'Restaurant reservation', payload: 'RESTAURANT_RESERVATION' }
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
// RESTART BUTTON
// ===============================
async function sendRestartButton(senderId
