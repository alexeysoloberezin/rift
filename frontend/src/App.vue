<script setup>
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { useAuthStore } from './stores/auth';

const auth = useAuthStore();
const route = useRoute();
</script>

<template>
  <div class="app-shell">
    <header class="site-header">
      <div class="container site-header__inner">
        <RouterLink to="/" class="brand">
          <img src="/logo.png" alt="RIFT" class="brand__logo" />
          <span class="brand__text">
            <span class="brand__mark">RIFT</span>
            <span class="brand__sub">CS2 Tournaments</span>
          </span>
        </RouterLink>

        <nav class="main-nav">
          <RouterLink to="/tournaments" active-class="is-active">Турниры</RouterLink>
          <RouterLink to="/players" active-class="is-active">Игроки</RouterLink>
          <RouterLink v-if="auth.isAuthenticated" to="/admin" active-class="is-active">Админка</RouterLink>
          <RouterLink v-else to="/admin/login" active-class="is-active">Вход для админа</RouterLink>
        </nav>
      </div>
    </header>

    <main class="site-main">
      <RouterView :key="route.fullPath" />
    </main>

    <footer class="site-footer">
      <div class="container">
        <span class="text-muted">RIFT PC Club — турниры по CS2</span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.site-header {
  border-bottom: 1px solid var(--line);
  background: rgba(16, 12, 13, 0.85);
  backdrop-filter: blur(6px);
  position: sticky;
  top: 0;
  z-index: 10;
}

.site-header::after {
  content: '';
  display: block;
  height: 2px;
  background: linear-gradient(90deg, var(--red) 0%, transparent 55%);
  opacity: 0.7;
}

.site-header__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 68px;
  flex-wrap: wrap;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand__logo {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  object-fit: cover;
  box-shadow: 0 0 0 1px var(--line), 0 0 16px rgba(216, 31, 31, 0.35);
}

.brand__text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.brand__mark {
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 800;
  letter-spacing: 0.04em;
  line-height: 1;
  color: var(--text);
}

.brand__sub {
  font-size: 11px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.main-nav {
  display: flex;
  gap: 28px;
  font-size: 14px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.main-nav a {
  color: var(--text-muted);
  padding-bottom: 4px;
  border-bottom: 2px solid transparent;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.main-nav a:hover {
  color: var(--text);
}

.main-nav a.is-active {
  color: var(--text);
  border-color: var(--red);
}

.site-main {
  flex: 1;
  padding: 40px 0 64px;
}

.site-footer {
  border-top: 1px solid var(--line);
  padding: 20px 0;
  font-size: 13px;
}

/* Ниже ~560px в один ряд шапка уже физически не помещается (лого + текст +
   4 пункта меню) — переносим меню на вторую строку вместо того, чтобы
   ужимать всё горизонтальным скроллом (то, что раньше "ломало" мобильную
   версию — сама шапка растягивала страницу вбок). */
@media (max-width: 560px) {
  .site-header__inner {
    height: auto;
    padding-top: 12px;
    padding-bottom: 12px;
  }

  .main-nav {
    width: 100%;
    gap: 8px 18px;
    flex-wrap: wrap;
  }

  .brand__logo {
    width: 32px;
    height: 32px;
  }

  .brand__mark {
    font-size: 21px;
  }

  .brand__sub {
    font-size: 10px;
  }
}
</style>
