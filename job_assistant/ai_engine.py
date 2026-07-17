import os
import google.generativeai as genai

def setup_gemini(api_key):
    """Configure the Gemini API."""
    genai.configure(api_key=api_key)

def generate_application_materials(resume_text, job_description_text):
    """Uses Gemini to generate a tailored cover letter and resume advice based on a job description."""

    prompt = f"""
    You are an expert career coach and technical recruiter. I will provide you with a candidate's base resume and a job description.

    Please provide the following:
    1. A professional, highly tailored cover letter for this specific job based on the candidate's resume.
    2. A list of 3-5 specific bullet points the candidate should add or tweak on their resume to better align with the job description.

    Candidate Resume:
    {resume_text}

    Job Description:
    {job_description_text}

    Format your response clearly with headings for "Cover Letter" and "Resume Suggestions".
    """

    try:
        # Use the recommended general-purpose model
        model = genai.GenerativeModel('gemini-1.5-flash')
        response = model.generate_content(prompt)
        return response.text
    except Exception as e:
        return f"Error generating materials: {str(e)}"
