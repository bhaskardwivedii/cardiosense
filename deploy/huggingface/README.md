---
title: CardioSense
emoji: 🫀
colorFrom: blue
colorTo: red
sdk: docker
app_port: 8000
pinned: false
---

# CardioSense on Hugging Face Spaces

1. Create a new Space, choose **Docker** as the SDK.
2. Push the whole repository to the Space, and copy this file to the repository root as `README.md`
   (Spaces reads the YAML header above from the root README).
3. In the Space settings add these secrets: `SECRET_KEY`, `ADMIN_PASSWORD`, and optionally `ADMIN_EMAIL`
   and `ENVIRONMENT=production`.

The free Space disk is not persistent, so the SQLite database resets when the Space restarts.
For a permanent history set `DATABASE_URL` to a hosted PostgreSQL database (for example Neon or Supabase).
