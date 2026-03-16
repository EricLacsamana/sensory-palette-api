'use strict';

const getTherapistId = (ctx) => {
  const user = ctx.state.user;
  if (user && user.role && (user.role.type === 'therapist' || user.role.name?.toLowerCase() === 'therapist')) {
    return Number(user.id);
  }
  return null;
};

module.exports = {
  async getGlobalData(ctx) {
    try {
      const { startDate, endDate } = ctx.query;
      const therapistId = getTherapistId(ctx);
      const data = await strapi.service('api::activity-session.activity-session').generateDashboardMetrics({ 
        startDate, endDate, therapistId 
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
      const therapistId = getTherapistId(ctx); 
      
      const data = await strapi.service('api::activity-session.activity-session').generateDashboardMetrics({ 
        startDate, 
        endDate, 
        studentId: Number(paramId), // Ensured it is an integer for user ID
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
      const therapistId = getTherapistId(ctx); 
      
      if (!baseStudent) {
        return ctx.badRequest('baseStudent id is required for comparison.');
      }

      const data = await strapi.service('api::activity-session.activity-session').generateComparisonMetrics({
        baseStudent: Number(baseStudent), 
        compareStudent: Number(compareStudent), 
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