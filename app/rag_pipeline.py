import os
import shutil

from pypdf import PdfReader
from dotenv import load_dotenv
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

load_dotenv()

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

def extract_text_from_pdf(pdf_path):
    reader = PdfReader(pdf_path)

    pages = []

    for page_number, page in enumerate(reader.pages, start=1):
        page_text = page.extract_text()

        if page_text:
            pages.append({
                "page_number": page_number,
                "text": page_text
            })

    return pages

def create_chunks(pages):
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200
    )

    chunks = []

    for page in pages:
        page_chunks = text_splitter.split_text(page["text"])

        for chunk in page_chunks:
            chunks.append({
                "text": chunk,
                "page_number": page["page_number"]
            })

    return chunks

def create_vector_store(chunks, user_id, document_id):
    persist_dir = f"vectorstore/user_{user_id}/doc_{document_id}"

    embeddings = HuggingFaceEmbeddings(
        model_name="sentence-transformers/all-MiniLM-L6-v2"
    )

    texts = [chunk["text"] for chunk in chunks]

    metadatas = [
        {"page_number": chunk["page_number"]}
        for chunk in chunks
    ]

    vector_store = Chroma.from_texts(
        texts=texts,
        metadatas=metadatas,
        embedding=embeddings,
        persist_directory=persist_dir
    )

    return vector_store

def retrieve_relevant_chunks(question, user_id, document_id, k=3):
    embeddings = HuggingFaceEmbeddings(
        model_name="sentence-transformers/all-MiniLM-L6-v2"
    )

    vector_store = Chroma(
        persist_directory=f"vectorstore/user_{user_id}/doc_{document_id}",
        embedding_function=embeddings
    )

    results = vector_store.similarity_search(question, k=k)

    return results

def generate_answer(question, user_id, document_id):
    results = retrieve_relevant_chunks(question, user_id, document_id)

    if not results:
        return {
            "answer": "I could not find this information in the document.",
            "sources": []
        }

    context = "\n\n".join([doc.page_content for doc in results])
    best_chunk = results[0]

    prompt = ChatPromptTemplate.from_template(
        """
        You are a helpful document assistant.

        Answer the question only using the context below.
        If the answer is not present in the context, say:
        "I could not find this information in the document."

        Context:
        {context}

        Question:
        {question}
        """
    )

    llm = ChatOpenAI(
        model="openrouter/free",
        api_key=OPENROUTER_API_KEY,
        base_url="https://openrouter.ai/api/v1",
        temperature=0.2
    )

    chain = prompt | llm

    try:
        response = chain.invoke({
            "context": context,
            "question": question
        })

        answer = response.content

    except Exception as e:
        print("LLM ERROR:", e)
        answer = "AI model is currently unavailable. Please try again after some time."

    clean_sources = [
        {
            "source_number": 1,
            "page_number": best_chunk.metadata.get("page_number"),
            "preview": " ".join(best_chunk.page_content.split())[:120] + "..."
        }
    ]

    return {
        "answer": answer,
        "sources": clean_sources
    }         