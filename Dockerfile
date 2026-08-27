FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
COPY static/ static/

ENV PORT=5000
EXPOSE 5000

# Simple container-level healthcheck, useful once this runs under Jenkins/orchestration
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request,os,sys; sys.exit(0) if urllib.request.urlopen('http://localhost:'+os.environ.get('PORT','5000')+'/health').status==200 else sys.exit(1)"

# gunicorn = production-grade server (not Flask's built-in dev server)
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "app:app"]