// Script simplificado para debug de notificaciones
console.log('🔍 [DEBUG] Script simplificado cargado');

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
    
    // Función simple para probar notificaciones
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
    
    console.log('🔍 [DEBUG] Ejecuta debugSimpleNotification() para probar notificaciones básicas');
});
