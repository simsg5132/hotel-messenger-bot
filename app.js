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

// Fetch user's first name
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

  if (!users[senderId]) {
    users[senderId] = {
      lang: null,
      finished: false,
      greeted: false,
      lastMessage: null
    };
  }

  const text = event.message?.text;

  // Prevent repeated responses
  if (text === users[senderId].lastMessage) return res.sendStatus(200);
  users[senderId].lastMessage = text;

  // -----------------------------
  // FIRST GREETING
  // -----------------------------
  if (!users[senderId].greeted) {
    users[senderId].greeted = true;
    const userName = await getUserName(senderId);
    await sendText(senderId, `Hello ${userName}! Please choose a language\nგამარჯობა ${userName}! გთხოვთ აირჩიოთ ენა`);
    await sendLanguageButtons(senderId);
    return res.sendStatus(200);
  }

  // -----------------------------
  // QUICK REPLY HANDLING
  // -----------------------------
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
        await sendRoomInfo(senderId, users[senderId].lang);
        break;
      case 'RESTAURANT_RESERVATION':
        await sendRestaurantInfo(senderId, users[senderId].lang);
        break;
      case 'SPA_RESERVATION':
        await sendSpaInfo(senderId, users[senderId].lang);
        break;
      case 'GO_BACK':
        await sendMainMenu(senderId, users[senderId].lang);
        break;
      case 'MORE_QUESTIONS':
        await sendText(senderId, users[senderId].lang === 'ka'
          ? `დამატებითი ინფორმაციის მისაღებად დაგვიკავშირდით ნომერზე:\n+995 322 448 888\n\nან მოგვწერეთ:\nAYS.Luxury@paragraphhotels.com\n\nან დაელოდეთ ოპერატორს`
          : `For additional information please contact us at:\n+995 322 448 888\n\nOr email us:\nAYS.Luxury@paragraphhotels.com\n\nOr wait for an operator`
        );
        break;
      case 'START_AGAIN':
        users[senderId].greeted = false;
        await sendText(senderId, `Hello! Please choose a language\nგამარჯობა! გთხოვთ აირჩიოთ ენა`);
        await sendLanguageButtons(senderId);
        break;
    }

    return res.sendStatus(200);
  }

  // -----------------------------
  // TEXT MESSAGE KEYWORD DETECTION
  // -----------------------------
  if (text && users[senderId].lang) {
    const lang = users[senderId].lang;

    if (containsKeyword(text, roomKeywords)) {
      await sendRoomInfo(senderId, lang);
    } else if (containsKeyword(text, restaurantKeywords)) {
      await sendRestaurantInfo(senderId, lang);
    } else if (containsKeyword(text, spaKeywords)) {
      await sendSpaInfo(senderId, lang);
    } else if (containsKeyword(text, thanksKeywords)) {
      await sendText(senderId, lang === 'ka' ? 'მადლობა დაკავშირებისთვის' : 'Thank you for contacting us');
    } else {
      // Fallback
      await sendText(senderId, lang === 'ka'
        ? `დამატებითი ინფორმაციის მისაღებად დაგვიკავშირდით ნომერზე:\n+995 322 448 888\n\nან მოგვწერეთ:\nAYS.Luxury@paragraphhotels.com\n\nან დაელოდეთ ოპერატორს`
        : `For additional information please contact us at:\n+995 322 448 888\n\nOr email us:\nAYS.Luxury@paragraphhotels.com\n\nOr wait for an operator`
      );
    }

    return res.sendStatus(200);
  }

  res.sendStatus(200);
});

// ===============================
// SEND FUNCTIONS
// ===============================
async function sendText(senderId, text) {
  await axios.post(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    { recipient: { id: senderId }, message: { text } }
  );
}

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

// Room, Restaurant, Spa info functions
async function sendRoomInfo(senderId, lang) {
  await sendText(senderId, lang === 'ka'
    ? `მოგესალმებით, ოთახების ფასებთან და ჯავშნებთან დაკავშირებული ნებისმიერი ინფორმაციის მისაღებად დაგვიკავშირდით ნომერზე:\n+995 322 448 888\n\nან მოგვწერეთ:\nAYS.Luxury@paragraphhotels.com\n\nდამატებითი ინფორმაციის მისაღებად, ეწვიეთ ჩვენს ვებგვერდს:\nhttps://www.marriott.com/en-us/hotels/tbslc-paragraph-freedom-square-a-luxury-collection-hotel-tbilisi/overview/`
    : `For room rates and reservations, please contact us at:\n+995 322 448 888\n\nOr email us:\nAYS.Luxury@paragraphhotels.com\n\nFor more information, visit our website:\nhttps://www.marriott.com/en-us/hotels/tbslc-paragraph-freedom-square-a-luxury-collection-hotel-tbilisi/`
  );
  await sendAfterInfoButtons(senderId, lang);
}

async function sendRestaurantInfo(senderId, lang) {
  await sendText(senderId, lang === 'ka'
    ? `მოგესალმებით, ჩვენი მენიუ შეგიძლიათ იხილოთ შემდეგ ბმულზე:\nhttps://linktr.ee/paragraphfreedomsquaretbilisi`
    : `You can view our menu at the following link:\nhttps://linktr.ee/paragraphfreedomsquaretbilisi`
  );
  await sendAfterInfoButtons(senderId, lang);
}

async function sendSpaInfo(senderId, lang) {
  await sendText(senderId, lang === 'ka'
    ? `სპას ერთდღიანი ვიზიტი:\nკვირის დღეებში – 150 ₾\nუქმეებზე – 220 ₾\n\nაბონემენტები:\n1 თვე – 950 ₾\n3 თვე – 2565 ₾\n6 თვე – 4560 ₾\n\nაბონიმენტი მოიცავს:\n• ულიმიტო ვიზიტს\n• 1 პერსონალური მწვრთნელი\n• 1 სპაში ვიზიტი მეგობრისთვის\n• 1 სპა პროცედურა\n• 12 სტუდიო ვარჯიში\n• იოგა, კარდიო პილატესი, პრამა\n• 15% ფასდაკლება სპა პროცედურებზე\n\nსპა პროცედურების ჩამონათვალი:\nhttps://linktr.ee/paragraphfreedomsquaretbilisi`
    : `One-day spa access:\nWeekdays – 150 GEL\nWeekends – 220 GEL\n\nMemberships:\n1 month – 950 GEL\n3 months – 2565 GEL\n6 months – 4560 GEL\n\nMembership includes:\n• Unlimited access\n• 1 personal trainer session\n• 1 spa visit for a friend\n• 1 spa treatment\n• 12 studio workouts\n• Yoga, cardio pilates, prama\n• 15% discount on spa treatments\n\nSpa treatment list:\nhttps://linktr.ee/paragraphfreedomsquaretbilisi`
  );
  await sendAfterInfoButtons(senderId, lang);
}

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
app.listen(3000, () => {
  console.log('Messenger bot running on port 3000');
});
