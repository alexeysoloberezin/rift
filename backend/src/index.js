import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.routes.js';
import tournamentsRoutes from './routes/tournaments.routes.js';
import matchesRoutes from './routes/matches.routes.js';
import demosRoutes from './routes/demos.routes.js';
import serverDemosRoutes from './routes/serverDemos.routes.js';
import playersRoutes from './routes/players.routes.js';
import groupsRoutes from './routes/groups.routes.js';
import bracketRoutes from './routes/bracket.routes.js';
import draftRoutes from './routes/draft.routes.js';
import { startSheetSyncPoller } from './services/sheetSync.service.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim());
app.use(cors({ origin: corsOrigins }));
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (req, res) => res.json({ success: true, status: 'ok', service: 'rift-backend' }));

app.use('/api/auth', authRoutes);
app.use('/api/tournaments', tournamentsRoutes);
app.use('/api', matchesRoutes); // /api/matches/:id, /api/tournaments/:id/matches
app.use('/api', demosRoutes); // /api/matches/:id/demo, /api/demos/:id
app.use('/api', serverDemosRoutes);
app.use('/api/players', playersRoutes);
app.use('/api', groupsRoutes); // /api/tournaments/:id/groups, /api/groups/:id
app.use('/api', bracketRoutes); // /api/tournaments/:id/bracket, /api/bracket-slots/:id
app.use('/api', draftRoutes); // /api/tournaments/:id/draft, /api/draft/captain/:token

// Единая обработка ошибок (например, слишком большой файл от multer)
app.use((err, req, res, next) => {
  console.error('❌ Необработанная ошибка:', err);
  res.status(err.status || 500).json({ success: false, error: err.message || 'Внутренняя ошибка сервера' });
});

app.listen(PORT, () => {
  console.log(`🚀 RIFT backend запущен на порту ${PORT}`);
  startSheetSyncPoller();
});
