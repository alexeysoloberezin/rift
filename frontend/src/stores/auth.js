import { defineStore } from 'pinia';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('rift_admin_token') || null,
    admin: JSON.parse(localStorage.getItem('rift_admin') || 'null'),
  }),
  getters: {
    isAuthenticated: (state) => Boolean(state.token),
  },
  actions: {
    setSession(token, admin) {
      this.token = token;
      this.admin = admin;
      localStorage.setItem('rift_admin_token', token);
      localStorage.setItem('rift_admin', JSON.stringify(admin));
    },
    logout() {
      this.token = null;
      this.admin = null;
      localStorage.removeItem('rift_admin_token');
      localStorage.removeItem('rift_admin');
    },
  },
});
