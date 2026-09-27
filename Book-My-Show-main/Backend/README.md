# Book My Show API

RESTful API for the static frontend in this folder. It uses Express and a JSON file store so it can be run locally without a database server.

## Run

```powershell
cd backend
npm install
npm start
```

Open `http://localhost:4000/home.html` for the frontend or `http://localhost:4000/api/health` for the API health check.

The first run creates `data.json` with demo records. Demo credentials:

- Admin: `admin@bookmyshow.local` / `admin123`
- Customer: `user@bookmyshow.local` / `demo123`

Set `ADMIN_PASSWORD` and `DEMO_PASSWORD` before the first run to change seeded passwords.

## Endpoints

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/movies`, `GET /api/movies/:id`, `POST /api/movies`, `PATCH /api/movies/:id`, `DELETE /api/movies/:id`
- `GET /api/theaters`, `POST /api/theaters`
- `GET /api/screens`, `POST /api/screens`
- `GET /api/shows`, `GET /api/shows/:id`, `POST /api/shows`
- `GET /api/seats`, `PATCH /api/seats/:id`
- `GET /api/bookings`, `GET /api/bookings/:id`, `POST /api/bookings`, `PATCH /api/bookings/:id/cancel`

Protected endpoints expect `Authorization: Bearer <token>`. List endpoints support `page` and `limit`; movies also support `search` and `status`, while shows support `movieId` and `date`.

`POST /api/bookings` checks that seats belong to the show screen and returns `409 Conflict` when any requested seat has already been booked.
