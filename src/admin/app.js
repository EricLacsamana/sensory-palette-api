
export default {
  
  config: {
    translations: {
      en: {
        "app.components.HomePage.welcome.title": "Welcome to Your Sensory Pallete Dashboard",
        "app.components.HomePage.welcome.content": "This is your new custom dashboard description.",
        "app.components.HomePage.button.blog": "Check our Documentation",

        "Auth.form.welcome.title": "Welcome",
        "Auth.form.welcome.subtitle": "Login your Sensory Pallete account.",
      },
    },
    theme: {
      light: {
        colors: {
          // Pale background for active menu items/labels
          primary100: '#E6F4FA', 
          // Light border/selection color
          primary200: '#BBE3F5',
          // The main "Sky Blue" color (#56B7E4)
          primary500: '#56B7E4', 
          // Slightly darker for hover states
          primary600: '#3DA5D6', 
          // Darker for active/pressed button states
          primary700: '#268CBF',
          
          // Button specific overrides
          buttonPrimary500: '#56B7E4',
          buttonPrimary600: '#3DA5D6',
        },
      },
    },
  },
  bootstrap(app) {
    console.log(app);
  },
};