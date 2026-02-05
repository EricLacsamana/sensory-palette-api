const config = {
  locales: [
    // 'ar',
    // 'fr',
    // 'cs',
    // 'de',
    // 'dk',
    // 'es',
    // 'he',
    // 'id',
    // 'it',
    // 'ja',
    // 'ko',
    // 'ms',
    // 'nl',
    // 'no',
    // 'pl',
    // 'pt-BR',
    // 'pt',
    // 'ru',
    // 'sk',
    // 'sv',
    // 'th',
    // 'tr',
    // 'uk',
    // 'vi',
    // 'zh-Hans',
    // 'zh',
  ],

    translations: {
      en: {
        "app.components.HomePage.welcome.title": "Welcome to Your Custom CMS",
        "app.components.HomePage.welcome.content": "This is your new custom dashboard description.",
        "app.components.HomePage.button.blog": "Check our Documentation",
      },
    },

};

const bootstrap = (app) => {
  console.log(app);
};

export default {
  config,
  bootstrap,
};
