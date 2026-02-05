export default async (policyContext, config, { strapi }) => {

  const ctx = policyContext.http?.ctx || policyContext;


  if (!ctx.query && ctx.request?.query) {
    ctx.query = ctx.request.query;
  }

  const user = ctx.state?.user;
  if (!user) return false;


  const userWithRole = await strapi.entityService.findOne('plugin::users-permissions.user', user.id, {
    populate: ['role'],
  });

  const roleType = userWithRole?.role?.type;


  if (roleType === 'therapist') {

    const currentFilters = ctx.query.filters || {};

    ctx.query = {
      ...ctx.query,
      filters: {
        ...currentFilters,
        role: {
          type: { $eq: 'student' }
        }
      }
    };
    
   
    ctx.request.query = ctx.query;

    console.log("Policy Log: Applied Student filter to Therapist request.");
  }

  return true;
};