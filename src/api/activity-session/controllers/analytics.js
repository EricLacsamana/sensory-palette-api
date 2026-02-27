'use strict';

// Helper function to extract the therapist ID from the authenticated user
const getTherapistId = (ctx) => {
  const user = ctx.state.user;
  // Check if user is authenticated and has the therapist role.
  // Adjust 'type' or 'name' based on how your roles are strictly defined in Strapi.
  if (user && user.role && (user.role.type === 'therapist' || user.role.name?.toLowerCase() === 'therapist')) {
    return user.id;
  }
  return null;
};

module.exports = {
  async getGlobalData(ctx) {
    try {
      const { startDate, endDate } = ctx.query;
      const therapistId = getTherapistId(ctx); // Get therapist ID if applicable

      // Pass the therapistId into the service
      const data = await strapi.service('api::activity-session.activity-session').generateDashboardMetrics({ 
        startDate, 
        endDate,
        therapistId 
      });
      
      ctx.body = { data };
    } catch (err) {
      strapi.log.error('Global Analytics Error:', err);
      ctx.throw(500, err.message);
    }
  },

  async getStudentData(ctx) {
    try {
      const paramId = ctx.params.id || ctx.params.studentId || ctx.params.documentId; 
      const { startDate, endDate } = ctx.query;
      const therapistId = getTherapistId(ctx); // Get therapist ID if applicable
      
      const data = await strapi.service('api::activity-session.activity-session').generateDashboardMetrics({ 
        startDate, 
        endDate, 
        studentId: Number(paramId), // Convert to Number for users-permissions 'id' matching
        therapistId
      });
      
      ctx.body = { data };
    } catch (err) {
      strapi.log.error('Student Analytics Error:', err);
      ctx.throw(500, err.message);
    }
  },

  async getComparisonData(ctx) {
    try {
      const { baseStudent, compareStudent, startDate, endDate } = ctx.query;
      const therapistId = getTherapistId(ctx); // Get therapist ID if applicable
      
      if (!baseStudent) {
        return ctx.badRequest('baseStudent documentId is required for comparison.');
      }

      // Pass therapistId so the comparison is also safely restricted
      const data = await strapi.service('api::activity-session.activity-session').generateComparisonMetrics({
        baseStudent, 
        compareStudent, 
        startDate, 
        endDate,
        therapistId
      });
      
      ctx.body = { data };
    } catch (err) {
      strapi.log.error('Comparison Analytics Error:', err);
      ctx.throw(500, err.message);
    }
  }
};