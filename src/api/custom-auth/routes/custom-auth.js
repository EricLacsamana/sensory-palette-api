'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/custom-auth/passcode-login',
      handler: 'custom-auth.passcodeLogin',
      config: {
        // ✨ This is crucial: It tells Strapi this route does NOT need a Bearer token
        // since the student is trying to log in!
        auth: false, 
      },
    },
  ],
};