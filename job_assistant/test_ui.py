from playwright.sync_api import sync_playwright

def test_job_assistant_ui():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            # 1. Navigate to the local Flask app
            page.goto("http://localhost:5000")

            # 2. Assert core elements are present
            assert page.get_by_role("heading", name="🤖 AI Job Application Assistant").is_visible()
            assert page.get_by_placeholder("Paste your resume text here...").is_visible()
            assert page.get_by_placeholder("https://linkedin.com/jobs/...").is_visible()

            # 3. Test adding a job to the log
            job_url_input = page.get_by_placeholder("https://linkedin.com/jobs/...")
            job_url_input.fill("https://www.linkedin.com/jobs/view/123456")

            job_title_input = page.get_by_placeholder("e.g. Software Engineer")
            job_title_input.fill("Senior Python Developer")

            company_input = page.get_by_placeholder("e.g. Google")
            company_input.fill("Acme Corp")

            page.get_by_role("button", name="Save to Log").click()

            # 4. Assert the job appears in the table
            assert page.get_by_text("Acme Corp").is_visible()
            assert page.get_by_text("Senior Python Developer").is_visible()
            assert page.get_by_text("Pending").is_visible()

            print("UI Test Passed Successfully!")

        except Exception as e:
            print(f"UI Test Failed: {str(e)}")
            raise e
        finally:
            browser.close()

if __name__ == "__main__":
    test_job_assistant_ui()