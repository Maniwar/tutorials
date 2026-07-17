import os
import threading
from flask import Flask, render_template, request, redirect, url_for, flash
from werkzeug.utils import secure_filename
import db
from ai_engine import setup_gemini, generate_application_materials
from linkedin_bot import apply_to_linkedin_job

app = Flask(__name__)
app.secret_key = 'super_secret_job_key'
app.config['UPLOAD_FOLDER'] = 'uploads'

db.init_db()
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

@app.route('/', methods=['GET'])
def index():
    jobs = db.get_jobs()
    return render_template('index.html', jobs=jobs)

@app.route('/add_job', methods=['POST'])
def add_job_route():
    job_url = request.form.get('job_url')
    title = request.form.get('job_title', 'Unknown Title')
    company = request.form.get('company', 'Unknown Company')
    if job_url:
        db.add_job(job_url, title, company)
        flash('Job added successfully!', 'success')
    return redirect(url_for('index'))

@app.route('/generate_materials', methods=['POST'])
def generate_materials_route():
    api_key = request.form.get('api_key')
    resume = request.form.get('resume_text')
    job_description = request.form.get('job_desc')
    try:
        setup_gemini(api_key)
        materials = generate_application_materials(resume, job_description)
        jobs = db.get_jobs()
        return render_template('index.html', jobs=jobs, materials=materials, api_key=api_key, resume_text=resume, job_desc=job_description)
    except Exception as e:
        flash(f'Error: {str(e)}', 'error')
        return redirect(url_for('index'))

@app.route('/auto_apply/<int:job_id>', methods=['POST'])
def auto_apply_route(job_id):
    job_url = request.form.get('job_url')
    file = request.files.get('resume_pdf')

    if not job_url:
        flash('Missing job URL.', 'error')
        return redirect(url_for('index'))

    resume_path = None
    if file and file.filename != '':
        filename = secure_filename(file.filename)
        resume_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(resume_path)

    thread = threading.Thread(target=apply_to_linkedin_job, args=(job_id, job_url, resume_path))
    thread.start()
    flash('Automated application process started in background window.', 'info')

    return redirect(url_for('index'))

if __name__ == '__main__':
    app.run(debug=True, port=5000)
