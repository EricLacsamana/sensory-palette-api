'use strict';

module.exports = {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/*{ strapi }*/) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */


  bootstrap({ strapi }) {
    // Helper function to calculate age
    const calculateAge = (dob) => {
      if (!dob) return null;
      const birthDate = new Date(dob);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();

      // Adjust if birthday hasn't happened yet this year
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      return age;
    };

    strapi.db.lifecycles.subscribe({
      models: ['plugin::users-permissions.user'],

      afterFindOne(event) {
        const { result } = event;
        if (result) {
          // 1. Calculate fullName
          result.fullName = (result.firstName && result.lastName)
            ? `${result.firstName} ${result.lastName}`
            : result.username;

          // 2. Calculate age if dateOfBirth exists
          if (result.dateOfBirth) {
            result.age = calculateAge(result.dateOfBirth);
          }
        }
      },

      afterFindMany(event) {
        const { result } = event;
        if (Array.isArray(result)) {
          result.forEach((user) => {
            // 1. Calculate fullName
            user.fullName = (user.firstName && user.lastName)
              ? `${user.firstName} ${user.lastName}`
              : user.username;

            // 2. Calculate age if dateOfBirth exists
            if (user.dateOfBirth) {
              user.age = calculateAge(user.dateOfBirth);
            }
          });
        }
      },
    });
  },
};

