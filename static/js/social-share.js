/**
 * Funciones para compartir en redes sociales
 * Incluye manejo seguro del clipboard con fallbacks
 */

/**
 * Copia texto al portapapeles con fallback para navegadores antiguos
 * @param {string} text - Texto a copiar
 * @param {Event} event - Evento del click
 */
function copyToClipboard(text, event) {
  // Intentar usar la API moderna del Clipboard
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(function() {
      showCopySuccess(event);
    }).catch(function(err) {
      console.warn('Error con Clipboard API, usando fallback:', err);
      fallbackCopyToClipboard(text, event);
    });
  } else {
    // Fallback para navegadores que no soportan Clipboard API o contextos no seguros
    fallbackCopyToClipboard(text, event);
  }
}

/**
 * Método fallback para copiar al portapapeles usando execCommand
 * NOTA: document.execCommand('copy') está obsoleto/descontinuado, pero se mantiene
 * intencionalmente como fallback para soporte de navegadores antiguos
 * que no tienen la API moderna de Clipboard.
 * @param {string} text - Texto a copiar
 * @param {Event} event - Evento del click
 */
function fallbackCopyToClipboard(text, event) {
  // Crear un elemento temporal
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  
  try {
    // execCommand está obsoleto, pero necesario para navegadores antiguos
    const successful = document.execCommand('copy');
    if (successful) {
      showCopySuccess(event);
    } else {
      showCopyError(event);
    }
  } catch (err) {
    console.error('Error al copiar con fallback:', err);
    showCopyError(event);
  } finally {
    document.body.removeChild(textArea);
  }
}

/**
 * Muestra feedback visual cuando la copia es exitosa
 * @param {Event} event - Evento del click
 */
function showCopySuccess(event) {
  const button = event.target.closest('.social-share__button--copy');
  if (!button) return;
  
  const span = button.querySelector('span');
  if (!span) return;
  
  const originalText = span.textContent;
  span.textContent = '¡Copiado!';
  button.classList.add('social-share__button--copied');
  
  setTimeout(() => {
    span.textContent = originalText;
    button.classList.remove('social-share__button--copied');
  }, 2000);
}

/**
 * Muestra feedback visual cuando hay error al copiar
 * @param {Event} event - Evento del click
 */
function showCopyError(event) {
  const button = event.target.closest('.social-share__button--copy');
  if (!button) return;
  
  const span = button.querySelector('span');
  if (!span) return;
  
  const originalText = span.textContent;
  span.textContent = 'Error al copiar';
  button.classList.add('social-share__button--error');
  
  setTimeout(() => {
    span.textContent = originalText;
    button.classList.remove('social-share__button--error');
  }, 2000);
}

/**
 * Valida que una URL sea segura para prevenir ataques XSS
 * @param {string} url - URL a validar
 * @returns {boolean} - true si la URL es segura
 */
function isValidUrl(url) {
  try {
    const urlObj = new URL(url);
    // Solo permitir protocolos seguros
    return ['http:', 'https:'].includes(urlObj.protocol);
  } catch (error) {
    return false;
  }
}

/**
 * Inicializar los botones de compartir cuando el DOM está listo
 */
document.addEventListener('DOMContentLoaded', function() {
  // Asegurar que todos los botones de copiar tengan el manejador correcto
  const copyButtons = document.querySelectorAll('.social-share__button--copy');
  copyButtons.forEach(button => {
    // Verificar si ya tiene el manejador
    if (!button.hasAttribute('data-initialized')) {
      button.setAttribute('data-initialized', 'true');
      
      button.addEventListener('click', function(event) {
        // Obtener la URL del data attribute o usar la URL actual como fallback
        let url = this.getAttribute('data-url') || window.location.href;
        
        // Validar la URL antes de usarla
        if (!isValidUrl(url)) {
          console.warn('URL no válida detectada, usando URL actual como fallback');
          url = window.location.href;
        }
        
        copyToClipboard(url, event);
      });
    }
  });
});
