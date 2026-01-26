from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from services import query_ollama

app = FastAPI()

# Enable CORS so our frontend (which might run on a different port or file://) can query this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For local demo, allow all. In prod, lock this down.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    message: str

class ChatResponse(BaseModel):
    reply: str

@app.get("/")
def read_root():
    return {"status": "Voice Agent Backend is running"}

@app.post("/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest):
    """
    Receives text from frontend, queries Ollama, returns AI text reply.
    """
    if not request.message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    
    print(f"User said: {request.message}")
    
    ai_reply = await query_ollama(request.message)
    
    print(f"AI replied: {ai_reply}")
    
    return ChatResponse(reply=ai_reply)

if __name__ == "__main__":
    import uvicorn
    # Run server on localhost:8000
    uvicorn.run(app, host="0.0.0.0", port=8000)
