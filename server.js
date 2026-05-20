const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
const scoreHandler = require('./api/score');
const reportHandler = require('./api/report');
const resolveHandler = require('./api/resolve');

dotenv.config({ path: path.join(__dirname, '.env.local') });
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 5500;

app.use(express.json());
app.use(express.static(__dirname));

app.post('/api/score', (req, res) => scoreHandler(req, res));
app.get('/api/report', (req, res) => reportHandler(req, res));
app.get('/api/resolve', (req, res) => resolveHandler(req, res));

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`SchemaRocket dev server running at http://localhost:${PORT}`);
});
