import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const routes = [
  { path: '/admin/map-veto', component: () => import('../views/admin/AdminMapVetoView.vue'), meta: { requiresAuth: true } },
  { path: '/map-veto/:token', component: () => import('../views/MapVetoView.vue') },
  { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
  { path: '/tournaments', name: 'tournaments', component: () => import('../views/TournamentsListView.vue') },
  { path: '/tournaments/:id', name: 'tournament-detail', component: () => import('../views/TournamentDetailView.vue') },
  { path: '/tournaments/:id/groups', name: 'tournament-groups', component: () => import('../views/GroupsView.vue') },
  { path: '/tournaments/:id/bracket', name: 'tournament-bracket', component: () => import('../views/BracketView.vue') },
  { path: '/tournaments/:id/draft', name: 'tournament-draft', component: () => import('../views/DraftView.vue') },
  // Капитанская ссылка на пики — доступ по секретному токену, без id турнира
  // в урле и без логина (см. draft.routes.js).
  { path: '/draft/:token', name: 'draft-captain', component: () => import('../views/DraftCaptainView.vue') },
  { path: '/matches/:id', name: 'match-detail', component: () => import('../views/MatchDetailView.vue') },
  { path: '/players', name: 'players', component: () => import('../views/PlayersListView.vue') },
  { path: '/players/:id', name: 'player-profile', component: () => import('../views/PlayerProfileView.vue') },

  { path: '/admin/login', name: 'admin-login', component: () => import('../views/admin/AdminLoginView.vue') },
  // Скрытый путь — нигде в навигации не отображается специально.
  // Работает только пока в базе нет ни одного админа (см. backend register-first-admin).
  { path: '/admin/setup', name: 'admin-setup', component: () => import('../views/admin/AdminSetupView.vue') },
  {
    path: '/admin',
    name: 'admin-dashboard',
    component: () => import('../views/admin/AdminDashboardView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/admin/tournaments/new',
    name: 'admin-tournament-new',
    component: () => import('../views/admin/AdminTournamentCreateView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/admin/tournaments/:id',
    name: 'admin-tournament-manage',
    component: () => import('../views/admin/AdminTournamentManageView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/admin/tournaments/:id/groups',
    name: 'admin-tournament-groups',
    component: () => import('../views/admin/AdminGroupsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/admin/tournaments/:id/bracket',
    name: 'admin-tournament-bracket',
    component: () => import('../views/admin/AdminBracketView.vue'),
    meta: { requiresAuth: true },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'admin-login', query: { redirect: to.fullPath } };
  }
  return true;
});

export default router;
