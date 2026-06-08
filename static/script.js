const authSection = document.getElementById("authSection");
const openDocsBtn = document.getElementById("openDocsBtn");
const openHistoryBtn = document.getElementById("openHistoryBtn");
const sidebar = document.querySelector(".sidebar");
const historyPanel = document.querySelector(".history-panel");
const dashboardSection = document.getElementById("dashboardSection");
const authTitle = document.getElementById("authTitle");
const authSubtitle = document.getElementById("authSubtitle");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const switchAuthMode = document.getElementById("switchAuthMode");

let isRegisterMode = false;

const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");
const loginBtn = document.getElementById("loginBtn");
const registerBtn = document.getElementById("registerBtn");
const authMessage = document.getElementById("authMessage");

const fileInput = document.getElementById("fileInput");
const uploadBtn = document.getElementById("uploadBtn");
const uploadResult = document.getElementById("uploadResult");

const questionInput = document.getElementById("questionInput");
const askBtn = document.getElementById("askBtn");
const chatBox = document.getElementById("chatBox");

const documentsList = document.getElementById("documentsList");
const historyList = document.getElementById("historyList");
const logoutBtn = document.getElementById("logoutBtn");

let selectedDocumentId = null;

function getToken() {
  return localStorage.getItem("token");
}

function resetChatScreen() {
  chatBox.innerHTML = `
    <div class="bot-message">
      Upload or select a document and ask me anything from it.
    </div>
  `;

  questionInput.value = "";
  uploadResult.textContent = "";

  sidebar.classList.remove("mobile-open");
  historyPanel.classList.remove("mobile-open");

  window.scrollTo(0, 0);
  scrollChatToBottom();
}

function showDashboard() {
  authSection.classList.add("hidden");
  dashboardSection.classList.remove("hidden");

  selectedDocumentId = null;
  resetChatScreen();

  loadDocuments();
  loadHistory();
}

function showAuth() {
  authSection.classList.remove("hidden");
  dashboardSection.classList.add("hidden");

  selectedDocumentId = null;
  resetChatScreen();

  window.scrollTo(0, 0);
}

if (getToken()) {
  showDashboard();
} else {
  showAuth();
}

registerBtn.addEventListener("click", async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();

  if (!email || !password) {
    authMessage.textContent = "Please enter email and password.";
    return;
  }

  authMessage.textContent = "Creating account...";

  try {
    const response = await fetch("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      authMessage.textContent = data.detail || "Registration failed.";
      return;
    }

    authMessage.textContent = "Account created. Now login.";
    passwordInput.value = "";
  } catch (error) {
       authMessage.textContent = "Registration failed.";
  }
});

loginBtn.addEventListener("click", async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();

  if (!email || !password) {
    authMessage.textContent = "Please enter email and password.";
    return;
  }

  authMessage.textContent = "Logging in...";

  try {
    const response = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      authMessage.textContent = data.detail || "Login failed.";
      return;
    }

    localStorage.setItem("token", data.access_token);
    authMessage.textContent = "Login successful.";
    showDashboard();
  } catch (error) {
       authMessage.textContent = "Login failed.";
  }
});

logoutBtn.addEventListener("click", () => {
  localStorage.removeItem("token");
  selectedDocumentId = null;

  emailInput.value = "";
  passwordInput.value = "";
  authMessage.textContent = "";

  resetChatScreen();
  showAuth();
});

uploadBtn.addEventListener("click", async () => {
  const file = fileInput.files[0];

  if (!file) {
    uploadResult.textContent = "Please select a PDF.";
    return;
  }

  const formData = new FormData();
  formData.append("file", file);

  uploadResult.textContent = "Uploading and processing...";

  try {
    const response = await fetch("/upload-document", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getToken()}`,
      },
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      uploadResult.textContent = data.detail || "Upload failed.";
      return;
    }

    selectedDocumentId = data.document_id;
    uploadResult.textContent = `${data.filename} uploaded | Chunks: ${data.chunks}`;
    fileInput.value = "";

    await loadDocuments(selectedDocumentId);
  } catch (error) {
       uploadResult.textContent = "Upload failed.";
  }
});

questionInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    askBtn.click();
  }
});

askBtn.addEventListener("click", async () => {
  const question = questionInput.value.trim();

  if (!question) return;

  if (!selectedDocumentId) {
    addMessage("Please select a document first.", "bot-message");
    return;
  }

  addMessage(question, "user-message");
  questionInput.value = "";

  const loadingMessage = addMessage("Thinking...", "bot-message");

  try {
    const response = await fetch("/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getToken()}`,
      },
      body: JSON.stringify({
        document_id: selectedDocumentId,
        question: question,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      loadingMessage.textContent = data.detail || "Something went wrong.";
      scrollChatToBottom();
      return;
    }

    const answerText = data.answer || "No answer found in document.";

    let sourcesHTML = "";

    if (data.sources && data.sources.length > 0) {
      const source = data.sources[0];

      sourcesHTML = `
      <details class="sources-box">
        <summary>View source</summary>

        <div class="source-item">

          <div class="source-page">
            Page ${source.page_number}
          </div>

          <p>${source.preview}</p>

        </div>
      </details>
    `;
    }

    loadingMessage.innerHTML = `
      <p>${answerText}</p>
      ${sourcesHTML}
    `;

    scrollChatToBottom();
    loadHistory();
  } catch (error) {
    loadingMessage.textContent = "Something went wrong.";
    scrollChatToBottom();
  }
});

function addMessage(text, className) {
  const message = document.createElement("div");
  message.className = className;
  message.textContent = text;
  chatBox.appendChild(message);

  scrollChatToBottom();

  return message;
}

async function loadDocuments(activeDocumentId = selectedDocumentId) {
  try {
    const response = await fetch("/documents", {
      headers: {
        Authorization: `Bearer ${getToken()}`,
      },
    });

    const data = await response.json();

    documentsList.innerHTML = "";

    if (!data.documents || data.documents.length === 0) {
      selectedDocumentId = null;
      documentsList.innerHTML = `<p class="small-text">No documents uploaded.</p>`;
      return;
    }

    if (!selectedDocumentId) {
      selectedDocumentId = data.documents[0].id;
    }

    data.documents.forEach((doc) => {
      const item = document.createElement("div");
      item.className = "document-item";

      const nameSpan = document.createElement("span");
      nameSpan.textContent = doc.filename;

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "×";
      deleteBtn.className = "delete-doc-btn";

      item.appendChild(nameSpan);
      item.appendChild(deleteBtn);

      if (doc.id === activeDocumentId || doc.id === selectedDocumentId) {
        item.classList.add("active-document");
      }

      deleteBtn.addEventListener("click", async (event) => {
        event.stopPropagation();

        const confirmDelete = confirm(`Delete ${doc.filename}?`);

        if (!confirmDelete) return;

        try {
          const response = await fetch(`/documents/${doc.id}`, {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${getToken()}`,
            },
          });

          let data = {};

          try {
            data = await response.json();
          } catch {
            data = {};
          }

          if (!response.ok) {
            alert(data.detail || "Delete failed.");
            return;
          }

          if (selectedDocumentId === doc.id) {
            selectedDocumentId = null;
            chatBox.innerHTML = `<div class="bot-message">Document deleted. Select another document.</div>`;
          }

          await loadDocuments();
          await loadHistory();
        } catch (error) {
          alert("Delete failed.");
        }
      });

      item.addEventListener("click", () => {
        selectedDocumentId = doc.id;

        document.querySelectorAll(".document-item").forEach((el) => {
          el.classList.remove("active-document");
        });

        item.classList.add("active-document");
        chatBox.innerHTML = `<div class="bot-message">Selected document: ${doc.filename}</div>`;
        scrollChatToBottom();

        if (window.innerWidth <= 900) {
          sidebar.classList.remove("mobile-open");
        }
      });

      documentsList.appendChild(item);
    });
  } catch (error) {
        documentsList.innerHTML = `<p class="small-text">Could not load documents.</p>`;
  }
}

async function loadHistory() {
  try {
    const response = await fetch("/chat-history", {
      headers: {
        Authorization: `Bearer ${getToken()}`,
      },
    });

    const data = await response.json();

    historyList.innerHTML = "";

    if (!data.chat_history || data.chat_history.length === 0) {
      historyList.innerHTML = `<p class="small-text">No chat history.</p>`;
      return;
    }

    data.chat_history
      .slice(-8)
      .reverse()
      .forEach((chat) => {
        const item = document.createElement("div");
        item.className = "history-item";

        item.innerHTML = `
          <div>
            <strong>${chat.question}</strong>
            <small>View answer</small>
          </div>
          <button class="delete-chat-btn">×</button>
        `;

        const deleteChatBtn = item.querySelector(".delete-chat-btn");

        deleteChatBtn.addEventListener("click", async (event) => {
          event.stopPropagation();

          try {
            const response = await fetch(`/chat-history/${chat.id}`, {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${getToken()}`,
              },
            });

            if (!response.ok) {
              alert("Chat delete failed.");
              return;
            }

            await loadHistory();
          } catch (error) {
                       alert("Chat delete failed.");
          }
        });

        item.addEventListener("click", () => {
          chatBox.innerHTML = "";

          addMessage(chat.question, "user-message");
          addMessage(
            chat.answer || "No answer found in document.",
            "bot-message",
          );

          if (window.innerWidth <= 900) {
            historyPanel.classList.remove("mobile-open");
          }

          scrollChatToBottom();
        });

        historyList.appendChild(item);
      });
  } catch (error) {
      historyList.innerHTML = `<p class="small-text">Could not load history.</p>`;
  }
}

switchAuthMode.addEventListener("click", () => {
  isRegisterMode = !isRegisterMode;

  if (isRegisterMode) {
    authTitle.textContent = "Create Account";
    authSubtitle.textContent = "Start chatting with your PDFs";
    loginBtn.classList.add("hidden");
    registerBtn.classList.remove("hidden");
    switchAuthMode.textContent = "Already have an account? Login";
  } else {
    authTitle.textContent = "Welcome Back";
    authSubtitle.textContent = "Login to continue";
    loginBtn.classList.remove("hidden");
    registerBtn.classList.add("hidden");
    switchAuthMode.textContent = "Don't have an account? Register";
  }

  authMessage.textContent = "";
});

registerBtn.classList.add("hidden");

openDocsBtn.addEventListener("click", () => {
  sidebar.classList.toggle("mobile-open");
  historyPanel.classList.remove("mobile-open");
});

openHistoryBtn.addEventListener("click", () => {
  historyPanel.classList.toggle("mobile-open");
  sidebar.classList.remove("mobile-open");
});

function scrollChatToBottom() {
  chatBox.scrollTo({
    top: chatBox.scrollHeight,
    behavior: "smooth",
  });
}
clearHistoryBtn.addEventListener("click", async () => {
  const confirmClear = confirm("Clear all chat history?");

  if (!confirmClear) return;

  try {
    const response = await fetch("/chat-history", {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${getToken()}`,
      },
    });

    if (!response.ok) {
      alert("Clear history failed.");
      return;
    }

    historyList.innerHTML = `<p class="small-text">No chat history.</p>`;
  } catch (error) {
      alert("Clear history failed.");
  }
});