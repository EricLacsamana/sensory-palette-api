'use strict';

module.exports = {
  register(/*{ strapi }*/) {},

  bootstrap({ strapi }) {
    // 1. Helper function to calculate age
    const calculateAge = (dob) => {
      if (!dob) return null;
      const birthDate = new Date(dob);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      return age;
    };

    // 2. Helper to format a single user object (Student)
    const formatUser = (user) => {
      if (!user) return;
      // Calculate fullName
      user.fullName = (user.firstName && user.lastName)
        ? `${user.firstName} ${user.lastName}`
        : user.username;

      // Calculate age
      if (user.dateOfBirth) {
        user.age = calculateAge(user.dateOfBirth);
      }
    };

    strapi.db.lifecycles.subscribe({
      // List all models that should trigger this formatting
      models: [
        'plugin::users-permissions.user', 
        'api::appointment.appointment',
        'api::activity-session.activity-session'
      ],

      afterFindOne(event) {
        const { result, model } = event;
        if (!result) return;

        // Logic for Direct User query
        if (model.uid === 'plugin::users-permissions.user') {
          formatUser(result);
        } 
        
        // Logic for Appointments OR Activity Sessions (Both use the "student" relation)
        if (
          (model.uid === 'api::appointment.appointment' || 
           model.uid === 'api::activity-session.activity-session') && 
          result.student
        ) {
          formatUser(result.student);
        }
      },

      afterFindMany(event) {
        const { result, model } = event;
        if (!Array.isArray(result)) return;

        result.forEach((item) => {
          // If items are Users
          if (model.uid === 'plugin::users-permissions.user') {
            formatUser(item);
          }
          
          // If items are Appointments or Activity Sessions
          if (
            (model.uid === 'api::appointment.appointment' || 
             model.uid === 'api::activity-session.activity-session') && 
            item.student
          ) {
            formatUser(item.student);
          }
        });
      },
    });
  },
};