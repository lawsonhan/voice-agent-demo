class VoiceAgentStateMachine {
  constructor(checkboxElement, buttonElement) {
    this.checkbox = checkboxElement;
    this.button = buttonElement;
    this.currentState = 'idle';
    this.isUpdating = false;
    this.timers = {
      listening: null,
      speaking: null
    };
    
    this.init();
  }
  
  init() {
    this.checkbox.addEventListener('change', () => {
      if (!this.isUpdating) {
        this.handleToggle();
      }
    });
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
    this.isUpdating = true;
    this.clearAllTimers();
    this.currentState = newState;
    
    // Remove all state classes
    this.button.classList.remove('state-listening', 'state-speaking');
    
    // Update checkbox state
    if (newState === 'idle') {
      this.checkbox.checked = false;
    } else {
      this.checkbox.checked = true;
      // Add state class for listening or speaking
      this.button.classList.add(`state-${newState}`);
    }
    
    this.isUpdating = false;
    
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
  
  handleToggle() {
    if (this.checkbox.checked) {
      // Toggle ON: transition to listening (only if idle)
      if (this.currentState === 'idle') {
        this.updateState('listening');
      }
    } else {
      // Toggle OFF: interrupt and return to idle
      this.updateState('idle');
    }
  }
}

// Initialize state machine when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggle');
  const orbButton = document.querySelector('.orb-button');
  if (toggle && orbButton) {
    new VoiceAgentStateMachine(toggle, orbButton);
  }
});
