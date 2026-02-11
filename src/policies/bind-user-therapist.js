
module.exports = async (policyContext, config, { strapi }) => {
  const user = policyContext.state.user;

  // 1. If no user is logged in, just let the request through
  if (!user) {
    return true; 
  }

  // 2. Check if the user is a therapist
  // (Assuming your role machine name is 'therapist')
  const isTherapist = user.role?.type === 'therapist';

  console.log('therapist', user);
  // 3. ATTACH: Only if they are a therapist
  if (isTherapist) {
    if (!policyContext.request.body.data) {
      policyContext.request.body.data = {};
    }
    
    // Injects the ID so it's bound to the database record
    policyContext.request.body.data.therapist = user.id;
    console.log(`📎 Therapist ID ${user.id} attached to the session request.`);
  }

  // 4. Continue to the controller regardless of role
  return true;
};