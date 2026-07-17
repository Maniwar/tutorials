import sqlite3
import os
from datetime import datetime

DB_FILE = 'jobs.db'

def init_db():
    """Initialize the SQLite database and create the jobs table if it doesn't exist."""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL,
            title TEXT,
            company TEXT,
            status TEXT DEFAULT 'Pending',
            date_applied TEXT
        )
    ''')
    conn.commit()
    conn.close()

def add_job(url, title="", company=""):
    """Add a new job application to the database."""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    date_applied = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    c.execute('INSERT INTO jobs (url, title, company, status, date_applied) VALUES (?, ?, ?, ?, ?)',
              (url, title, company, 'Pending', date_applied))
    conn.commit()
    conn.close()

def get_jobs():
    """Retrieve all jobs from the database."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row # Returns dict-like objects
    c = conn.cursor()
    c.execute('SELECT * FROM jobs ORDER BY id DESC')
    jobs = c.fetchall()
    conn.close()
    return jobs

def update_job_status(job_id, status):
    """Update the status of a job."""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('UPDATE jobs SET status = ? WHERE id = ?', (status, job_id))
    conn.commit()
    conn.close()

if __name__ == '__main__':
    # Initialize when script is run directly
    init_db()
    print("Database initialized.")