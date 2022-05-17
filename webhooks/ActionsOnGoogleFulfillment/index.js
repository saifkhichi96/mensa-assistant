const {
    conversation,
    Card,
    Collection,
    Image,
    Suggestion,
} = require('@assistant/conversation');
const functions = require('firebase-functions');
const fetch = require('node-fetch');

const apiUrl = 'https://www.mensa-kl.de/api.php?date=0&format=json';

// Create a new app instance
const app = conversation();

// Strings (in all supported languages) to be used in the action
s = {
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
    'CANCEL': {
        'en': 'Cancel',
        'de': 'Abbrechen'
    }
};

/**
 * Parse the response from the API and return a list of menu items.
 *
 * @param {string} response the API response.
 * @returns {Array} the list of all the items on the menu.
 */
function prepareMenu(response) {
    try {
        // Parse the API response as JSON
        const menu = JSON.parse(response);

        // If there is nothing on the menu, return empty array
        if (menu.length === 0) {
            return [];
        }

        for (let i = 0; i < menu.length; i++) {
            // Fix image URLs for all items. Use placeholder if no image is available
            let imageUrl = menu[i].image;
            if (imageUrl === '') {
                imageUrl = 'https://servedcatering.com/wp-content/uploads/2021/05/menu-item-placeholder.png';
            } else {
                imageUrl = 'https://www.mensa-kl.de/mimg/' + imageUrl;
            }

            menu[i].image = new Image({url: imageUrl, alt: menu[i].title});
        }

        // Return the menu
        return menu;
    } catch (ex) {
        // If the API response is not valid JSON, return empty array
        return [];
    }
}

/**
 * Get the language of the conversation.
 *
 * @param conv the conversation object
 * @returns {string} the language code (default: en)
 */
function getLanguage(conv) {
    try {
        const locale = conv.user.locale;  // Get user locale (e.g., en-US or de-DE)
        return locale.substring(0, 2);  // Extract language code (e.g., en or de)
    } catch (e) {
        return 'en';
    }
}

/**
 * Get the printable location of the food item.
 *
 * Each item is usually served at a specific location. For example, the
 * location might be "Ausgabe 1", "Ausgabe 2" or "Atrium".
 *
 * @param item the food item
 * @returns {string} the location
 */
function getItemLocation(item) {
    switch (item.loc) {
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

/**
 * Find the vegetarian option on the menu.
 *
 * @param {Array} menu the list of all the items on the menu
 * @returns {any|null} the vegetarian option
 */
function findVeggieItem(menu) {
    for (let i = 0; i < menu.length; i++) {
        if (menu[i].icon === 'veg') {
            return menu[i];
        }
    }
    return null;
}

/**
 * Find the cheapest options on the menu.
 *
 * If multiple items have the same lowest price, all of them are returned.
 *
 * @param {Array} menu the list of all the items on the menu
 * @returns {Array} list of the cheapest options
 */
function findCheapestItems(menu) {
    // Find the cheapest price
    let cheapestPrice = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < menu.length; i++) {
        const price = parseFloat(menu[i].price);
        if (price < cheapestPrice) {
            cheapestPrice = price;
        }
    }

    // Find all items with the cheapest price
    const cheapestItems = [];
    for (let i = 0; i < menu.length; i++) {
        const price = parseFloat(menu[i].price);
        if (price === cheapestPrice) {
            cheapestItems.push(menu[i]);
        }
    }

    return cheapestItems;
}

/**
 * Create a view for the given food item.
 *
 * @param item the food item
 * @returns {Card} a card to display the food item
 */
function createCard(item) {
    return new Card({
        title: getItemLocation(item),
        subtitle: '€' + item.price + ' | ' + item.icon,
        text: item.title,
        image: item.image
    })
}

/**
 * Create a view for the list of food items.
 *
 * @param {Array} items the list of food items
 * @param conv the conversation object
 * @returns {Collection} a collection of cards to show the food items
 */
function createCollection(items, conv) {
    let keys = [];
    let entries = [];
    for (let i = 0; i < items.length; i++) {
        let item = items[i];
        let key = item.loc;

        keys[i] = {key: key};
        entries[i] = {
            name: key,
            synonyms: [],
            display: {
                title: item.title,
                description: '€' + item.price + ' | ' + getItemLocation(item) + ' | ' + item.icon,
                image: item.image
            }
        };
    }

    conv.session.typeOverrides = [{
        name: 'prompt_option',
        mode: 'TYPE_REPLACE',
        synonym: {entries: entries},
    }];

    return new Collection({
        title: 'TUK Mensa',
        subtitle: items[0].date,
        items: keys,
    });
}

/**
 * Ask user a question and optionally suggest some responses.
 *
 * @param conv the conversation object
 * @param {string} question the question to ask
 * @param {Array<string>} suggestions list of response suggestions to show
 */
function ask(conv, question, suggestions) {
    conv.add(question);
    for (let i = 0; i < suggestions.length; i++) {
        conv.add(new Suggestion({title: suggestions[i]}));
    }
}

// What is for lunch today?
app.handle('food', async (conv) => {
    const lang = getLanguage(conv);
    const response = await fetch(apiUrl);
    const menu = prepareMenu(await response.text());

    if (menu.length === 0) {
        conv.add(s.CLOSED[lang]);
        ask(conv, s.MORE[lang], [s.CANCEL[lang]]);
    } else {
        conv.add(s.ALL_s[lang] + menu.length.toString() + s.ALL_e[lang]);
        conv.add(createCollection(menu, conv));
        ask(conv, s.MORE[lang], [s.VEGGI[lang], s.CHEAP[lang], s.CANCEL[lang]]);
    }
});

// Where is the meatless alternative?
app.handle('veggie', async (conv) => {
    const lang = getLanguage(conv);
    const response = await fetch(apiUrl);
    const menu = prepareMenu(await response.text());

    if (menu.length === 0) {
        conv.add(s.CLOSED[lang]);
        ask(conv, s.MORE[lang], [s.CANCEL[lang]]);
    } else {
        let veggieItem = findVeggieItem(menu);
        if (veggieItem == null) {
            conv.add(s.NO_VEGGI[lang]);
            ask(conv, s.MORE[lang], [s.CHEAP[lang], s.CANCEL[lang]]);
        } else {
            const location = getItemLocation(veggieItem);
            conv.add(s.VEGGI_LOC[lang] + location + ". ");
            conv.add(createCard(veggieItem));
            ask(conv, veggieItem.title + ' in €' + veggieItem.price + '. ' + s.MORE[lang],
                [s.CHEAP[lang], s.CANCEL[lang]]);
        }
    }
});

// Where is the cheaper option?
app.handle('cheap', async (conv) => {
    const lang = getLanguage(conv);
    const response = await fetch(apiUrl);
    const menu = prepareMenu(await response.text());

    if (menu.length === 0) {
        conv.add(s.CLOSED[lang]);
        ask(conv, s.MORE[lang], [s.CANCEL[lang]]);
    } else {
        let cheapestItems = findCheapestItems(menu);
        if (cheapestItems.length === 0) {
            conv.add(s.NONE[lang]);
            ask(conv, s.MORE[lang], [s.CANCEL[lang]]);
        } else {
            const location = getItemLocation(cheapestItems[0]);
            conv.add(location + s.CHEAP_LOC[lang]);
            conv.add(createCollection(cheapestItems, conv));
            ask(conv, s.MORE[lang], [s.VEGGI[lang], s.CANCEL[lang]]);
        }
    }
});

exports.ActionsOnGoogleFulfillment = functions.https.onRequest(app);