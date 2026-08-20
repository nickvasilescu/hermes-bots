// Paint the persisted theme before React loads without requiring an inline
// script exception in the desktop Content Security Policy.
try {
  let background = localStorage.getItem('hermes-boot-background')
  let colorScheme = localStorage.getItem('hermes-boot-color-scheme')

  if (!background) {
    background = '#070707'
    colorScheme = 'dark'
  }

  document.documentElement.style.backgroundColor = background

  if (colorScheme === 'dark' || colorScheme === 'light') {
    document.documentElement.style.colorScheme = colorScheme
  }
} catch {
  // Storage can be unavailable in a freshly isolated renderer. The CSS theme
  // will take over once the application bundle loads.
}
