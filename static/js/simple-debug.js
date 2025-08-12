// Script simplificado para debug de notificaciones
console.log('🔍 [DEBUG] Script simplificado cargado');

// Función simple para probar notificaciones - disponible inmediatamente
window.debugSimpleNotification = async function() {
    console.log('🔍 [DEBUG] Probando notificación simple...');
    
    if (Notification.permission === 'granted') {
        new Notification('🐬 Test Simple', {
            body: 'Esta es una notificación simple de prueba',
            icon: '/favicon-192x192.png'
        });
    } else if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            new Notification('🐬 Test Simple', {
                body: 'Permiso concedido, esta es una notificación de prueba',
                icon: '/favicon-192x192.png'
            });
        }
    } else {
        console.log('🔍 [DEBUG] Permisos denegados');
    }
};

// Función para diagnosticar completamente - disponible inmediatamente
window.debugCompleto = function() {
    console.log('🔍 === DIAGNÓSTICO COMPLETO ===');
    console.log('1. Soporte del navegador:');
    console.log('   - serviceWorker:', 'serviceWorker' in navigator);
    console.log('   - PushManager:', 'PushManager' in window);
    console.log('   - Notification:', 'Notification' in window);
    
    console.log('2. Permisos:', Notification.permission);
    
    console.log('3. Configuraciones:');
    console.log('   - PWA_SECURE_CONFIG:', window.PWA_SECURE_CONFIG);
    console.log('   - siteConfig:', window.siteConfig);
    
    console.log('4. Manager:');
    console.log('   - pushManager disponible:', !!window.pushManager);
    if (window.pushManager) {
        console.log('   - isSupported:', window.pushManager.isSupported);
        console.log('   - vapidPublicKey:', !!window.pushManager.vapidPublicKey);
        console.log('   - registration:', !!window.pushManager.registration);
    }
    
    console.log('5. DOM:');
    console.log('   - subscribe-btn:', !!document.getElementById('subscribe-btn'));
    console.log('   - unsubscribe-btn:', !!document.getElementById('unsubscribe-btn'));
    console.log('   - notification-status:', !!document.getElementById('notification-status'));
    
    return 'Diagnóstico completado. Revisa los logs arriba.';
};

// Función para probar suscripción manualmente - disponible inmediatamente
window.debugSuscripcion = async function() {
    console.log('🔍 [DEBUG] Probando suscripción manual...');
    
    if (!window.pushManager) {
        console.error('❌ pushManager no disponible');
        return;
    }
    
    try {
        await window.pushManager.subscribe();
        console.log('✅ Suscripción manual exitosa');
    } catch (error) {
        console.error('❌ Error en suscripción manual:', error);
    }
};

console.log('🔍 [DEBUG] Funciones disponibles:');
console.log('   - debugCompleto() - Diagnóstico completo');
console.log('   - debugSimpleNotification() - Test de notificación básica');
console.log('   - debugSuscripcion() - Test de suscripción manual');

// Esperar a que el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
    console.log('🔍 [DEBUG] DOM listo, verificando notificaciones...');
    
    // Verificar elementos básicos
    const subscribeBtn = document.getElementById('subscribe-btn');
    const unsubscribeBtn = document.getElementById('unsubscribe-btn');
    const statusSpan = document.getElementById('notification-status');
    
    console.log('🔍 [DEBUG] Elementos encontrados:', {
        subscribeBtn: !!subscribeBtn,
        unsubscribeBtn: !!unsubscribeBtn,
        statusSpan: !!statusSpan
    });
    
    // Agregar listener básico para debugging
    if (subscribeBtn) {
        subscribeBtn.addEventListener('click', function(e) {
            console.log('🔍 [DEBUG] Click detectado en botón suscribir');
            console.log('🔍 [DEBUG] Estado actual de Notification.permission:', Notification.permission);
            
            // Verificar si tenemos las configuraciones necesarias
            console.log('🔍 [DEBUG] PWA_SECURE_CONFIG:', window.PWA_SECURE_CONFIG);
            console.log('🔍 [DEBUG] siteConfig:', window.siteConfig);
            
            // Verificar pushManager global
            console.log('🔍 [DEBUG] window.pushManager:', window.pushManager);
        });
    }
});
