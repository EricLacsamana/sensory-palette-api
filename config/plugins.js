export default ({ env }) => ({
  'users-permissions': {
    config: {
      register: {
        allowedFields: ['role', 'firstname', 'lastname'],
      },
    },
  },
});