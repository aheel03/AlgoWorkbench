import 'dotenv/config';
import { createApp } from './app.js';

const port = Number(process.env.PORT) || 3001;
const server = createApp().listen(port, process.env.HOST || '127.0.0.1', () => console.log(`AlgoWorkbench API: http://localhost:${port}`));
server.requestTimeout = 60000;
