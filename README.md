# SketchToUI Backend

Node.js + Express backend for SketchToUI. Converts hand-drawn wireframes and UI sketches into Flutter Dart code using Google Gemini Vision.

## Tech Stack
- **Framework**: Node.js & Express
- **AI Vision**: Google Gemini Flash API (`gemini-2.5-flash` / `gemini-1.5-flash`)
- **Asset Storage**: Cloudinary CDN
- **Database**: Zero-config SQLite (local development) or Cloud PostgreSQL (production / Render)
- **Auth**: JWT & bcryptjs

## Environment Variables
Set these in your `.env` or Render environment settings:
- `PORT`: Server port (default: 5000)
- `JWT_SECRET`: Secret key for JWT signing
- `GEMINI_API_KEY`: Google AI Studio Gemini API Key
- `CLOUDINARY_CLOUD_NAME`: Cloudinary cloud name
- `CLOUDINARY_API_KEY`: Cloudinary API key
- `CLOUDINARY_API_SECRET`: Cloudinary API secret
- `DATABASE_URL`: (Optional) PostgreSQL connection string. If omitted, uses embedded SQLite.

## API Endpoints
- `GET /health`: Healthcheck
- `POST /api/auth/register`: Register user
- `POST /api/auth/login`: Authenticate user
- `POST /api/generate`: Upload sketch image + screen name -> Returns detected components + generated Flutter Dart code
- `GET /api/history`: List user's past generations
