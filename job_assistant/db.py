import sqlite3
import os
from datetime import datetime

DB_FILE = 'jobs.db'

def init_db():
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
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    date_applied = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    c.execute('INSERT INTO jobs (url, title, company, status, date_applied) VALUES (?, ?, ?, ?, ?)',
              (url, title, company, 'Pending', date_applied))
    conn.commit()
    conn.close()

def get_jobs():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute('SELECT * FROM jobs ORDER BY id DESC')
    jobs = c.fetchall()
    conn.close()
    return jobs

def update_job_status(job_id, status):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('UPDATE jobs SET status = ? WHERE id = ?', (status, job_id))
    conn.commit()
    conn.close()

if __name__ == '__main__':
    init_db()
