import pandas as pd

final_data = []

# 1️⃣ SMS Spam Dataset
try:
    sms = pd.read_csv("dataset/spam.csv", encoding="latin-1")
    sms = sms[['v1', 'v2']]
    sms.columns = ['label', 'text']
    sms['label'] = sms['label'].map({'spam': 1, 'ham': 0})
    final_data.append(sms)
except:
    print("Skipping spam.csv")

# 2️⃣ Enron Spam Dataset
try:
    enron = pd.read_csv("dataset/enron_spam_data.csv")
    enron = enron[['message', 'label']]
    enron.columns = ['text', 'label']
    final_data.append(enron)
except:
    print("Skipping enron_spam_data.csv")

# 3️⃣ Fake Job Posting Dataset
try:
    jobs = pd.read_csv("dataset/fake_job_postings.csv")
    jobs = jobs[['description', 'fraudulent']]
    jobs.columns = ['text', 'label']
    final_data.append(jobs)
except:
    print("Skipping fake_job_postings.csv")

# 4️⃣ Phishing Email Dataset (.xlsx)
try:
    phishing_email = pd.read_excel("dataset/phishing_dataset (1).xlsx")
    phishing_email = phishing_email.iloc[:, :2]
    phishing_email.columns = ['text', 'label']
    final_data.append(phishing_email)
except:
    print("Skipping phishing_dataset.xlsx")

# 5️⃣ Phishing URL Dataset
try:
    urls = pd.read_csv("dataset/PhiUSIIL_Phishing_URL_Dataset.csv")
    urls = urls[['URL', 'label']]
    urls.columns = ['text', 'label']
    final_data.append(urls)
except:
    print("Skipping URL dataset")

# Merge everything
dataset = pd.concat(final_data, ignore_index=True)

# Clean dataset
dataset.dropna(inplace=True)
dataset.drop_duplicates(inplace=True)

# Save merged dataset
dataset.to_csv("rei_training_dataset.csv", index=False)

print("Merged dataset saved as rei_training_dataset.csv")
print("Total samples:", len(dataset))