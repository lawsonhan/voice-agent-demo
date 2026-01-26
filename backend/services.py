import httpx

OLLAMA_URL = "http://localhost:11434/api/chat"
MODEL_NAME = "qwen3:1.7b"  # User provided model name

async def query_ollama(user_message: str):
    """
    Sends the user's message to the local Ollama instance and returns the response.
    """
    
    # System prompt to keep responses concise for voice interaction
    system_instruction = {
        "role": "system",
        "content": "You are a helpful voice assistant. Keep your answers concise, conversational, and short (under 1 sentences if possible) because your output will be spoken aloud."
    }
    
    payload = {
        "model": MODEL_NAME,
        "messages": [
            system_instruction,
            {"role": "user", "content": user_message}
        ],
        "stream": False # Set to True later for advanced usage
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(OLLAMA_URL, json=payload)
            response.raise_for_status()
            
            data = response.json()
            # Extract actual text response from Ollama format
            # Ollama /api/chat response: { "message": { "content": "..." }, ... }
            return data.get("message", {}).get("content", "Sorry, I couldn't understand that.")
            
    except Exception as e:
        print(f"Error connecting to Ollama: {e}")
        return f"Error: Could not connect to AI model. Ensure Ollama is running with {MODEL_NAME}."
