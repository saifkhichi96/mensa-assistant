const {
  conversation,
  Card,
  Collection,
  Image,
  Suggestion,
} = require('@assistant/conversation');
const functions = require('firebase-functions');
const fetch = require('node-fetch');

const app = conversation();
const api = 'https://www.mensa-kl.de/api.php?date=0&format=json';

strings = {
  'CLOSED': {
    'en': 'The Mensa is closed today. 😔 ',
    'de': 'Die Mensa ist heute geschlossen. 😔 ',
  },
  'NONE': {
    'en': 'There is nothing on the menu today. ',
    'de': 'Leider haben wir heute keine Angebote. ',
  },
  'ALL_s': {
    'en': 'Today, we have ',
    'de': 'Heute haben wir ',
  },
  'ALL_e': {
    'en': ' items on the menu. ',
    'de': ' Angebote. ',
  },
  'CHEAP': {
    'en': 'Cheapest',
    'de': 'Billiger',
  },
  'CHEAP_LOC': {
    'en': ' has the cheapest food. ',
    'de': ' hat das billigste Angebot. ',
  },
  'VEGGI': {
    'en': 'Meatless',
    'de': 'Fleischlos',
	},
  'NO_VEGGI': {
    'en': 'There is no vegetarian alternative available today. ',
    'de': 'Fleischlose Alternative heute nicht verfügbar. ',
  },
  'VEGGI_LOC': {
    'en': 'The meatless option is in ',
    'de': 'Die fleischlose Alternative ist in ',
  },
  'MORE': {
    'en': 'Can I help you with anything else? ',
    'de': 'Kann ich sonst noch helfen? ',
  },
  'CANCEL' : {
    'en': 'Cancel',
    'de': 'Abbrechen'
  }
};

function get_user_language(conv) {
  lang = 'en';
  if (conv.user.locale.startsWith('de')) {
    lang = 'de';
  }
  return lang;
}

function preprocess(menu) {
  try {
    menu = JSON.parse(responseText);
    if (menu.length == 0) {
      return null;
    }

    for (let i = 0; i < menu.length; i++) {
      imageUrl = menu[i].image;
      if (imageUrl == '') {
        imageUrl = 'https://servedcatering.com/wp-content/uploads/2021/05/menu-item-placeholder.png';
      } else {
        imageUrl = 'https://www.mensa-kl.de/mimg/' + imageUrl;
      }

      menu[i].image = new Image({ url: imageUrl, alt: menu[i].title });
    }

    return menu;
  } catch(ex) {
    return null;
  }
}

function get_location(item) {
  switch(item.loc) {
    case '1':
    case '1veg':
      return 'Ausgabe 1';
    case '2':
    case '2veg':
      return 'Ausgabe 2';
    case 'Feelgood':
      return 'Atrium (Feelgood)';
    default:
      return item.loc;
  }
}

function find_veggie(menu) {
  for (let i = 0; i < menu.length; i++) {
    if (menu[i].icon == 'veg') {
      return menu[i];
    }
  }
  return null;
}

function find_cheapest(menu) {
  cheapest = null;
  for (let i = 0; i < menu.length; i++) {
    if (cheapest == null || parseFloat(cheapest.price) > parseFloat(menu[i].price)) {
      cheapest = menu[i];
    }
  }
  
  all = [];
  if (cheapest != null) {
    for (let i = 0; i < menu.length; i++) {
      if (parseFloat(cheapest.price) == parseFloat(menu[i].price)) {
        all.push(menu[i]);
      }
    }
  }
  return all;
}

function to_collection(menu, conv) {
  keys = [];
  entries = [];
  for (let i = 0; i < menu.length; i++) {
  	item = menu[i];
    key = item.loc;
    
    keys[i] = { key: key };
    entries[i] = {
      name: key,
      synonyms: [],
      display: {
        title: item.title,
        description: '€' + item.price + ' | ' + get_location(item) +  ' | ' + item.icon,
        image: item.image
      }
    };
  }
  
  conv.session.typeOverrides = [{
    name: 'prompt_option',
    mode: 'TYPE_REPLACE',
    synonym: { entries: entries },
  }];
  
  return new Collection({
    title: 'TUK Mensa',
    subtitle: menu[0].date,
    image_fill: "CROPPED",
    items: keys,
  });
}

// What is for lunch today?
app.handle('food', async (conv) => {
  lang = get_user_language(conv);
  response = await fetch(api);
  responseText = await response.text();
  menu = preprocess(responseText);
  if (menu == null) {
	  conv.add(strings.CLOSED[lang]);
    return;
  }

  conv.add(strings.ALL_s[lang] + menu.length.toString() + strings.ALL_e[lang]);
  collection = to_collection(menu, conv);
  conv.add(collection);
  conv.add(strings.MORE[lang]);
  conv.add(new Suggestion({ title: strings.VEGGI[lang] }));
  conv.add(new Suggestion({ title: strings.CHEAP[lang] }));
});

// Where is the meatless alternative?
app.handle('veggie', async (conv) => {
  lang = get_user_language(conv);
  response = await fetch(api);
  responseText = await response.text();
  menu = preprocess(responseText);
  if (menu == null) {
	  conv.add(strings.CLOSED[lang]);
    return;
  }

  item = find_veggie(menu);
  if (item == null) {
    conv.add(strings.NO_VEGGI[lang]);
  } else {
    location = get_location(item);
    conv.add(strings.VEGGI_LOC[lang] + location + ". ");
    conv.add(new Card({
      title: location,
      subtitle: '€' + item.price + ' | ' + item.icon,
      text: item.title,
      image: item.image
    }));
    conv.add(item.title + ' in €' + item.price + '. ' + strings.MORE[lang]);
  }
});

// Where is the cheaper option?
app.handle('cheap', async (conv) => {
  lang = get_user_language(conv);
  response = await fetch(api);
  responseText = await response.text();
  menu = preprocess(responseText);
  if (menu == null) {
	  conv.add(strings.CLOSED[lang]);
  } else {
    items = find_cheapest(menu);
    if (items.length == 0) {
      conv.add(strings.NONE[lang]);
    } else {
      const location = get_location(items[0]);
      conv.add(location + strings.CHEAP_LOC[lang]);
      conv.add(to_collection(items, conv));
    }
  }

  conv.add(strings.MORE[lang]);
  conv.add(new Suggestion({ title: strings.VEGGI[lang] }));
  conv.add(new Suggestion({ title: strings.CANCEL[lang] }));
});

exports.ActionsOnGoogleFulfillment = functions.https.onRequest(app);