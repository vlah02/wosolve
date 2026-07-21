# WoSolve production image.
# Build:  docker build -t wosolve .
# Run:    docker run -p 8000:8000 wosolve   ->   http://localhost:8000
FROM python:3.12-slim

# Keep Python lean and unbuffered so logs stream in real time.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

WORKDIR /app

# Install dependencies first so this layer caches across code changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application.
COPY . .

# Run as a non-root user.
RUN useradd --create-home --uid 10001 appuser
USER appuser

EXPOSE 8000

# Serve with gunicorn. $PORT lets hosts (Render, Fly, Railway) inject their port.
CMD ["sh", "-c", "gunicorn app:app --workers 2 --bind 0.0.0.0:${PORT}"]
