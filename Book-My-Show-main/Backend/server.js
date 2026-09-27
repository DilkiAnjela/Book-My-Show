const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const FRONTEND_DIR = path.resolve(__dirname, '..');
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => ({
  salt,
  hash: crypto.scryptSync(password, salt, 64).toString('hex')
});
const passwordMatches = (password, account) => {
  const candidate = crypto.scryptSync(password, account.passwordSalt, 64);
  const stored = Buffer.from(account.passwordHash, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
};

function seedData() {
  if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

  const adminPassword = hashPassword(process.env.ADMIN_PASSWORD || 'admin123');
  const demoPassword = hashPassword(process.env.DEMO_PASSWORD || 'demo123');
  const admin = {
    id: id('usr'), name: 'System Admin', email: 'admin@bookmyshow.local', role: 'admin',
    passwordHash: adminPassword.hash, passwordSalt: adminPassword.salt, createdAt: now()
  };
  const demoUser = {
    id: id('usr'), name: 'Demo Customer', email: 'user@bookmyshow.local', role: 'customer',
    passwordHash: demoPassword.hash, passwordSalt: demoPassword.salt, createdAt: now()
  };
  const movie = {
    id: id('mov'), title: 'Interstellar', genre: 'Sci-Fi', language: 'English',
    durationMinutes: 169, description: 'A team travels through a wormhole in search of a future for humanity.',
    posterUrl: 'https://m.media-amazon.com/images/I/71niXI3lxlL._AC_SY679_.jpg', status: 'active', createdAt: now()
  };
  const theater = { id: id('thr'), name: 'Galaxy Cinema', location: 'Central Mall', status: 'active', createdAt: now() };
  const screen = { id: id('scr'), theaterId: theater.id, name: 'Screen 1', totalSeats: 120, createdAt: now() };
  const show = {
    id: id('shw'), movieId: movie.id, screenId: screen.id, startsAt: '2026-02-05T19:30:00.000Z',
    price: 10, status: 'scheduled', createdAt: now()
  };
  const seats = Array.from({ length: 24 }, (_, index) => ({
    id: id('set'), screenId: screen.id, label: `${String.fromCharCode(65 + Math.floor(index / 6))}${(index % 6) + 1}`,
    type: 'standard', status: 'available'
  }));

  const data = {
    users: [admin, demoUser], sessions: [], movies: [movie], theaters: [theater], screens: [screen],
    shows: [show], seats, bookings: [], payments: []
  };
  save(data);
  return data;
}

let db = seedData();
function save(data = db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
function publicUser(user) {
  const { passwordHash, passwordSalt, ...safeUser } = user;
  return safeUser;
}
function fail(status, message, details) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
}
function requireFields(body, fields) {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === '');
  if (missing.length) throw fail(400, 'Missing required fields', { fields: missing });
}
function findOr404(collection, value, label) {
  const item = db[collection].find((entry) => entry.id === value);
  if (!item) throw fail(404, `${label} not found`);
  return item;
}
function paginate(items, request) {
  const page = Math.max(Number(request.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(request.query.limit) || 20, 1), 100);
  const start = (page - 1) * limit;
  return { data: items.slice(start, start + limit), pagination: { page, limit, total: items.length, pages: Math.ceil(items.length / limit) } };
}

function authenticate(request, response, next) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  const session = db.sessions.find((entry) => entry.token === token);
  if (!session) return response.status(401).json({ error: { message: 'Authentication required' } });
  request.user = findOr404('users', session.userId, 'User');
  next();
}
function adminOnly(request, response, next) {
  if (request.user.role !== 'admin') return response.status(403).json({ error: { message: 'Admin access required' } });
  next();
}

app.get('/api/health', (request, response) => response.json({ status: 'ok', service: 'book-my-show-api', time: now() }));

app.post('/api/auth/register', (request, response, next) => {
  try {
    requireFields(request.body, ['name', 'email', 'password']);
    if (String(request.body.password).length < 6) throw fail(400, 'Password must be at least 6 characters');
    const email = String(request.body.email).trim().toLowerCase();
    if (db.users.some((user) => user.email === email)) throw fail(409, 'Email is already registered');
    const password = hashPassword(String(request.body.password));
    const user = { id: id('usr'), name: String(request.body.name).trim(), email, role: 'customer', passwordHash: password.hash, passwordSalt: password.salt, createdAt: now() };
    db.users.push(user); save();
    response.status(201).json({ data: publicUser(user) });
  } catch (error) { next(error); }
});

app.post('/api/auth/login', (request, response, next) => {
  try {
    requireFields(request.body, ['email', 'password']);
    const user = db.users.find((entry) => entry.email === String(request.body.email).trim().toLowerCase());
    if (!user || !passwordMatches(String(request.body.password), user)) throw fail(401, 'Invalid email or password');
    const token = crypto.randomBytes(32).toString('hex');
    db.sessions.push({ token, userId: user.id, createdAt: now() }); save();
    response.json({ data: { token, user: publicUser(user) } });
  } catch (error) { next(error); }
});

app.post('/api/auth/logout', authenticate, (request, response) => {
  const token = request.headers.authorization.replace(/^Bearer\s+/i, '');
  db.sessions = db.sessions.filter((session) => session.token !== token); save();
  response.status(204).send();
});
app.get('/api/auth/me', authenticate, (request, response) => response.json({ data: publicUser(request.user) }));

app.get('/api/movies', (request, response) => {
  let movies = db.movies;
  if (request.query.status) movies = movies.filter((movie) => movie.status === request.query.status);
  if (request.query.search) movies = movies.filter((movie) => movie.title.toLowerCase().includes(String(request.query.search).toLowerCase()));
  response.json(paginate(movies, request));
});
app.get('/api/movies/:id', (request, response, next) => { try { response.json({ data: findOr404('movies', request.params.id, 'Movie') }); } catch (error) { next(error); } });
app.post('/api/movies', authenticate, adminOnly, (request, response, next) => {
  try {
    requireFields(request.body, ['title', 'genre', 'durationMinutes']);
    const movie = { id: id('mov'), title: String(request.body.title).trim(), genre: String(request.body.genre).trim(), language: request.body.language || 'English', durationMinutes: Number(request.body.durationMinutes), description: request.body.description || '', posterUrl: request.body.posterUrl || '', status: request.body.status || 'active', createdAt: now() };
    if (!Number.isFinite(movie.durationMinutes) || movie.durationMinutes <= 0) throw fail(400, 'durationMinutes must be a positive number');
    db.movies.push(movie); save(); response.status(201).json({ data: movie });
  } catch (error) { next(error); }
});
app.patch('/api/movies/:id', authenticate, adminOnly, (request, response, next) => { try { const movie = findOr404('movies', request.params.id, 'Movie'); Object.assign(movie, request.body, { id: movie.id, updatedAt: now() }); save(); response.json({ data: movie }); } catch (error) { next(error); } });
app.delete('/api/movies/:id', authenticate, adminOnly, (request, response, next) => { try { findOr404('movies', request.params.id, 'Movie'); db.movies = db.movies.filter((movie) => movie.id !== request.params.id); save(); response.status(204).send(); } catch (error) { next(error); } });

app.get('/api/theaters', (request, response) => response.json(paginate(db.theaters, request)));
app.post('/api/theaters', authenticate, adminOnly, (request, response, next) => { try { requireFields(request.body, ['name', 'location']); const theater = { id: id('thr'), name: request.body.name, location: request.body.location, status: 'active', createdAt: now() }; db.theaters.push(theater); save(); response.status(201).json({ data: theater }); } catch (error) { next(error); } });
app.get('/api/screens', (request, response) => { const screens = request.query.theaterId ? db.screens.filter((screen) => screen.theaterId === request.query.theaterId) : db.screens; response.json(paginate(screens, request)); });
app.post('/api/screens', authenticate, adminOnly, (request, response, next) => { try { requireFields(request.body, ['theaterId', 'name', 'totalSeats']); findOr404('theaters', request.body.theaterId, 'Theater'); const screen = { id: id('scr'), theaterId: request.body.theaterId, name: request.body.name, totalSeats: Number(request.body.totalSeats), createdAt: now() }; if (!Number.isInteger(screen.totalSeats) || screen.totalSeats < 1) throw fail(400, 'totalSeats must be a positive integer'); db.screens.push(screen); save(); response.status(201).json({ data: screen }); } catch (error) { next(error); } });

app.get('/api/shows', (request, response) => { let shows = db.shows; if (request.query.movieId) shows = shows.filter((show) => show.movieId === request.query.movieId); if (request.query.date) shows = shows.filter((show) => show.startsAt.startsWith(request.query.date)); response.json(paginate(shows, request)); });
app.get('/api/shows/:id', (request, response, next) => { try { const show = findOr404('shows', request.params.id, 'Show'); const screen = findOr404('screens', show.screenId, 'Screen'); const bookedSeatIds = db.bookings.filter((booking) => booking.showId === show.id && booking.status === 'confirmed').flatMap((booking) => booking.seatIds); response.json({ data: { ...show, movie: findOr404('movies', show.movieId, 'Movie'), screen, seats: db.seats.filter((seat) => seat.screenId === screen.id).map((seat) => ({ ...seat, status: bookedSeatIds.includes(seat.id) ? 'booked' : seat.status })) } }); } catch (error) { next(error); } });
app.post('/api/shows', authenticate, adminOnly, (request, response, next) => { try { requireFields(request.body, ['movieId', 'screenId', 'startsAt', 'price']); findOr404('movies', request.body.movieId, 'Movie'); findOr404('screens', request.body.screenId, 'Screen'); const show = { id: id('shw'), movieId: request.body.movieId, screenId: request.body.screenId, startsAt: request.body.startsAt, price: Number(request.body.price), status: 'scheduled', createdAt: now() }; if (!Number.isFinite(show.price) || show.price < 0) throw fail(400, 'price must be zero or more'); db.shows.push(show); save(); response.status(201).json({ data: show }); } catch (error) { next(error); } });

app.get('/api/seats', (request, response) => { const seats = request.query.screenId ? db.seats.filter((seat) => seat.screenId === request.query.screenId) : db.seats; response.json(paginate(seats, request)); });
app.patch('/api/seats/:id', authenticate, adminOnly, (request, response, next) => { try { const seat = findOr404('seats', request.params.id, 'Seat'); if (request.body.label) seat.label = request.body.label; if (request.body.type) seat.type = request.body.type; if (request.body.status) seat.status = request.body.status; save(); response.json({ data: seat }); } catch (error) { next(error); } });

app.get('/api/bookings', authenticate, (request, response) => { const bookings = request.user.role === 'admin' ? db.bookings : db.bookings.filter((booking) => booking.userId === request.user.id); response.json(paginate(bookings, request)); });
app.get('/api/bookings/:id', authenticate, (request, response, next) => { try { const booking = findOr404('bookings', request.params.id, 'Booking'); if (request.user.role !== 'admin' && booking.userId !== request.user.id) throw fail(403, 'You can only view your own bookings'); response.json({ data: booking }); } catch (error) { next(error); } });
app.post('/api/bookings', authenticate, (request, response, next) => {
  try {
    requireFields(request.body, ['showId', 'seatIds']);
    if (!Array.isArray(request.body.seatIds) || request.body.seatIds.length === 0) throw fail(400, 'seatIds must be a non-empty array');
    const show = findOr404('shows', request.body.showId, 'Show');
    const uniqueSeatIds = [...new Set(request.body.seatIds)];
    const seats = uniqueSeatIds.map((seatId) => findOr404('seats', seatId, 'Seat'));
    if (seats.some((seat) => seat.screenId !== show.screenId)) throw fail(400, 'All seats must belong to the show screen');
    const bookedSeatIds = db.bookings.filter((booking) => booking.showId === show.id && booking.status === 'confirmed').flatMap((booking) => booking.seatIds);
    const conflicts = uniqueSeatIds.filter((seatId) => bookedSeatIds.includes(seatId));
    if (conflicts.length) throw fail(409, 'One or more seats are already booked', { seatIds: conflicts });
    const booking = { id: id('bok'), userId: request.user.id, showId: show.id, seatIds: uniqueSeatIds, amount: Number((show.price * uniqueSeatIds.length).toFixed(2)), status: 'confirmed', createdAt: now() };
    db.bookings.push(booking); save(); response.status(201).json({ data: booking });
  } catch (error) { next(error); }
});
app.patch('/api/bookings/:id/cancel', authenticate, (request, response, next) => { try { const booking = findOr404('bookings', request.params.id, 'Booking'); if (request.user.role !== 'admin' && booking.userId !== request.user.id) throw fail(403, 'You can only cancel your own bookings'); if (booking.status !== 'confirmed') throw fail(409, 'Only confirmed bookings can be cancelled'); booking.status = 'cancelled'; booking.cancelledAt = now(); save(); response.json({ data: booking }); } catch (error) { next(error); } });

app.use('/api', (request, response) => response.status(404).json({ error: { message: 'API route not found' } }));
app.use(express.static(FRONTEND_DIR));
app.use((error, request, response, next) => {
  const status = error.status || 500;
  response.status(status).json({ error: { message: status === 500 ? 'Internal server error' : error.message, ...(error.details ? { details: error.details } : {}) } });
});

app.listen(PORT, () => console.log(`Book My Show API running at http://localhost:${PORT}`));
