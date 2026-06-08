import os
import shutil
from datetime import datetime, timedelta

from fastapi import FastAPI, Request, UploadFile, File, Depends, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.security import OAuth2PasswordBearer

from pydantic import BaseModel
from sqlalchemy.orm import Session
from passlib.context import CryptContext
from jose import jwt, JWTError

from app.database import engine, get_db
from app.models import Base, User, Document, ChatHistory
from app.rag_pipeline import (
    extract_text_from_pdf,
    create_chunks,
    create_vector_store,
    generate_answer
)


app = FastAPI(title="Document Reader RAG Chatbot")

Base.metadata.create_all(bind=engine)

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
SECRET_KEY = os.getenv("SECRET_KEY")

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")


class QuestionRequest(BaseModel):
    question: str
    document_id: int


class RegisterRequest(BaseModel):
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


def hash_password(password: str):
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str):
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(data: dict):
    to_encode = data.copy()

    expire = datetime.utcnow() + timedelta(
        minutes=ACCESS_TOKEN_EXPIRE_MINUTES
    )

    to_encode.update({"exp": expire})

    encoded_jwt = jwt.encode(
        to_encode,
        SECRET_KEY,
        algorithm=ALGORITHM
    )

    return encoded_jwt


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM]
        )

        email = payload.get("sub")

        if email is None:
            raise HTTPException(
                status_code=401,
                detail="Invalid token"
            )

    except JWTError:
        raise HTTPException(
            status_code=401,
            detail="Invalid token"
        )

    user = db.query(User).filter(User.email == email).first()

    if user is None:
        raise HTTPException(
            status_code=401,
            detail="User not found"
        )

    return user


@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html"
    )


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "message": "Backend is running"
    }


@app.post("/register")
def register_user(
    request: RegisterRequest,
    db: Session = Depends(get_db)
):
    existing_user = db.query(User).filter(
        User.email == request.email
    ).first()

    if existing_user:
        raise HTTPException(
            status_code=400,
            detail="Email already registered"
        )

    new_user = User(
        email=request.email,
        hashed_password=hash_password(request.password)
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return {
        "message": "User registered successfully",
        "user_id": new_user.id,
        "email": new_user.email
    }


@app.post("/login")
def login_user(
    request: LoginRequest,
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(
        User.email == request.email
    ).first()

    if not user:
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password"
        )

    if not verify_password(request.password, user.hashed_password):
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password"
        )

    access_token = create_access_token(
        data={
            "sub": user.email,
            "user_id": user.id
        }
    )

    return {
        "access_token": access_token,
        "token_type": "bearer"
    }


@app.get("/me")
def get_me(
    current_user: User = Depends(get_current_user)
):
    return {
        "id": current_user.id,
        "email": current_user.email
    }


@app.post("/upload-document")
async def upload_document(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    upload_dir = "data/uploads"
    os.makedirs(upload_dir, exist_ok=True)

    file_path = os.path.join(upload_dir, file.filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    pages = extract_text_from_pdf(file_path)
    chunks = create_chunks(pages)

    new_document = Document(
        filename=file.filename,
        file_path=file_path,
        vectorstore_path="",
        user_id=current_user.id
    )

    db.add(new_document)
    db.commit()
    db.refresh(new_document)

    vectorstore_path = f"vectorstore/user_{current_user.id}/doc_{new_document.id}"

    create_vector_store(
        chunks,
        current_user.id,
        new_document.id
    )

    new_document.vectorstore_path = vectorstore_path

    db.commit()
    db.refresh(new_document)

    total_characters = sum(len(page["text"]) for page in pages)

    return {
        "message": "File uploaded and stored successfully",
        "document_id": new_document.id,
        "filename": file.filename,
        "characters": total_characters,
        "chunks": len(chunks)
    }


@app.post("/ask")
def ask_question(
    request: QuestionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    document = db.query(Document).filter(
        Document.id == request.document_id,
        Document.user_id == current_user.id
    ).first()

    if not document:
        raise HTTPException(
            status_code=404,
            detail="Document not found"
        )

    result = generate_answer(
        request.question,
        current_user.id,
        request.document_id
    )

    new_chat = ChatHistory(
        question=request.question,
        answer=result["answer"],
        user_id=current_user.id,
        document_id=request.document_id
    )

    db.add(new_chat)
    db.commit()
    db.refresh(new_chat)

    return {
        "chat_id": new_chat.id,
        "question": request.question,
        "answer": result["answer"],
        "sources": result["sources"]
    }


@app.get("/documents")
def get_documents(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    documents = db.query(Document).filter(
        Document.user_id == current_user.id
    ).all()

    return {
        "documents": [
            {
                "id": doc.id,
                "filename": doc.filename,
                "file_path": doc.file_path,
                "vectorstore_path": doc.vectorstore_path,
                "created_at": doc.created_at
            }
            for doc in documents
        ]
    }

@app.delete("/documents/{document_id}")
def delete_document(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    document = db.query(Document).filter(
        Document.id == document_id,
        Document.user_id == current_user.id
    ).first()

    if not document:
        raise HTTPException(
            status_code=404,
            detail="Document not found"
        )

    if os.path.exists(document.file_path):
        os.remove(document.file_path)

    if document.vectorstore_path and os.path.exists(document.vectorstore_path):
        try:
            shutil.rmtree(document.vectorstore_path)
        except PermissionError:
            print("Vectorstore is locked. Skipping folder delete for now.")
        except Exception as e:
            print("Vectorstore delete error:", e)

    db.query(ChatHistory).filter(
        ChatHistory.document_id == document_id,
        ChatHistory.user_id == current_user.id
    ).delete()

    db.delete(document)
    db.commit()

    return {
        "message": "Document deleted successfully",
        "document_id": document_id
    }

@app.get("/chat-history")
def get_chat_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    chats = db.query(ChatHistory).filter(
        ChatHistory.user_id == current_user.id
    ).all()

    return {
        "chat_history": [
            {
                "id": chat.id,
                "question": chat.question,
                "answer": chat.answer,
                "document_id": chat.document_id,
                "created_at": chat.created_at
            }
            for chat in chats
        ]
    }

@app.delete("/chat-history/{chat_id}")
def delete_chat(
    chat_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    chat = db.query(ChatHistory).filter(
        ChatHistory.id == chat_id,
        ChatHistory.user_id == current_user.id
    ).first()

    if not chat:
        raise HTTPException(
            status_code=404,
            detail="Chat not found"
        )

    db.delete(chat)
    db.commit()

    return {
        "message": "Chat deleted successfully",
        "chat_id": chat_id
    }

@app.delete("/chat-history")
def clear_chat_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    db.query(ChatHistory).filter(
        ChatHistory.user_id == current_user.id
    ).delete()

    db.commit()

    return {
        "message": "Chat history cleared successfully"
    }   