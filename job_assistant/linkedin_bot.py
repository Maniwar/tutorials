from playwright.sync_api import sync_playwright
import time
import os
from db import update_job_status

# Path to store browser session state (cookies, login status)
USER_DATA_DIR = os.path.join(os.getcwd(), "browser_data")

def apply_to_linkedin_job(job_id, job_url, resume_path=None):
    update_job_status(job_id, "In Progress")

    with sync_playwright() as p:
        # Launch with persistent context and headless=False so user can intervene if needed
        # (e.g., to log in the very first time)
        browser_context = p.chromium.launch_persistent_context(
            user_data_dir=USER_DATA_DIR,
            headless=False,
            args=["--start-maximized"]
        )
        page = browser_context.pages[0]

        try:
            page.goto(job_url, timeout=45000)
            page.wait_for_timeout(3000) # Let page load fully

            # 1. Check if we are logged in (if not, we'd need to pause for the user to login)
            if page.locator("a[href*='login']").is_visible():
                print("Not logged in. Please log into the browser window.")
                page.wait_for_timeout(30000) # Give user 30 seconds to login manually on first run

            # 2. Find and click Easy Apply
            easy_apply_button = page.locator("button:has-text('Easy Apply'), button:has-text('Apply now')").first

            if easy_apply_button.is_visible():
                easy_apply_button.click()
                page.wait_for_timeout(2000)

                # 3. Enter the Modal Loop
                max_steps = 15 # safety break
                step = 0

                while step < max_steps:
                    step += 1

                    # Check if we reached the final submit button
                    submit_btn = page.locator("button:has-text('Submit application')")
                    if submit_btn.is_visible():
                        submit_btn.click()
                        update_job_status(job_id, "Applied Successfully!")
                        page.wait_for_timeout(2000)
                        break

                    # Handle Resume Upload if the field exists
                    if resume_path and os.path.exists(resume_path):
                        # Look for file inputs specifically requesting resumes
                        file_input = page.locator("input[type='file']").first
                        if file_input.is_visible():
                            try:
                                file_input.set_input_files(resume_path)
                                page.wait_for_timeout(1000)
                            except:
                                pass # Some inputs might not be interactable

                    # Look for Next or Review buttons to continue through the form
                    next_btn = page.locator("button:has-text('Next')")
                    review_btn = page.locator("button:has-text('Review')")

                    if next_btn.is_visible():
                        next_btn.click()
                        page.wait_for_timeout(1000)
                    elif review_btn.is_visible():
                        review_btn.click()
                        page.wait_for_timeout(1000)
                    else:
                        # If we can't find Next, Review, or Submit, the script is stuck (e.g. required field missing)
                        print("Stuck on a required field or unknown form state.")
                        update_job_status(job_id, "Manual Intervention Required")
                        break

            else:
                update_job_status(job_id, "Manual Apply Required")

        except Exception as e:
            print(f"Error automating LinkedIn: {str(e)}")
            update_job_status(job_id, "Failed")

        finally:
            browser_context.close()
