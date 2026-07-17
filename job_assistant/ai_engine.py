import os
import google.generativeai as genai

def setup_gemini(api_key):
    genai.configure(api_key=api_key)

def generate_application_materials(resume_text, job_description_text):
    prompt = f"""
    You are an expert career coach and technical recruiter. I will provide you with a candidate's base resume and a job description.
    Please provide:
    1. A professional, highly tailored cover letter.
    2. A list of 3-5 specific bullet points the candidate should add or tweak on their resume.
    Candidate Resume:\n{resume_text}\n
    Job Description:\n{job_description_text}
    """
    try:
        model = genai.GenerativeModel('gemini-1.5-flash')
        response = model.generate_content(prompt)
        return response.text
    except Exception as e:
        return f"Error generating materials: {str(e)}"
