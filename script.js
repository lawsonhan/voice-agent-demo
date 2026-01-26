class VoiceAgentStateMachine {
  constructor(buttonElement) {
    this.button = buttonElement;
    this.currentState = 'idle';
    this.timers = {
      listening: null,
      speaking: null
    };
    
    this.init();
  }
  
  init() {
    this.button.addEventListener('click', () => this.handleClick());
    this.updateState('idle');
  }
  
  clearAllTimers() {
    if (this.timers.listening) {
      clearTimeout(this.timers.listening);
      this.timers.listening = null;
    }
    if (this.timers.speaking) {
      clearTimeout(this.timers.speaking);
      this.timers.speaking = null;
    }
  }
  
  updateState(newState) {
    this.clearAllTimers();
    this.currentState = newState;
    
    // Remove all state classes
    this.button.classList.remove('state-idle', 'state-listening', 'state-speaking');
    // Add new state class
    this.button.classList.add(`state-${newState}`);
    
    // Set up timers based on new state
    if (newState === 'listening') {
      this.timers.listening = setTimeout(() => {
        this.updateState('speaking');
      }, 3000);
    } else if (newState === 'speaking') {
      this.timers.speaking = setTimeout(() => {
        this.updateState('idle');
      }, 5000);
    }
  }
  
  handleClick() {
    if (this.currentState === 'idle') {
      this.updateState('listening');
    } else {
      // Interrupt any state and return to idle
      this.updateState('idle');
    }
  }
}

// Initialize state machine when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const voiceButton = document.getElementById('voiceButton');
  if (voiceButton) {
    new VoiceAgentStateMachine(voiceButton);
  }
});
