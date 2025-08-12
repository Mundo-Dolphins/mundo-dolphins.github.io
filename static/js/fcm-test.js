// Script de testing local para FCM sin configuración real
window.testFCMLocal = function() {
    console.log('🧪 === TEST FCM LOCAL ===');
    
    // Verificar soporte básico
    console.log('1. Verificando soporte:');
    console.log('   - serviceWorker:', 'serviceWorker' in navigator);
    console.log('   - Notification:', 'Notification' in window);
    console.log('   - PushManager:', 'PushManager' in window);
    
    // Verificar Firebase
    console.log('2. Verificando Firebase:');
    console.log('   - firebase disponible:', typeof firebase !== 'undefined');
    if (typeof firebase !== 'undefined') {
        console.log('   - firebase.messaging:', !!firebase.messaging);
        console.log('   - messaging.isSupported:', firebase.messaging && firebase.messaging.isSupported());
    }
    
    // Verificar configuración
    console.log('3. Verificando configuración:');
    console.log('   - FCM_CONFIG:', window.FCM_CONFIG);
    
    // Verificar manager
    console.log('4. Verificando manager:');
    console.log('   - fcmManager:', !!window.fcmManager);
    if (window.fcmManager) {
        console.log('   - isSupported:', window.fcmManager.isSupported);
        console.log('   - config:', !!window.fcmManager.config);
    }
    
    return 'Test completado. Revisa la consola para detalles.';
};

// Función para simular notificación sin FCM
window.testNotificationLocal = async function() {
    console.log('🧪 Probando notificación local...');
    
    if (Notification.permission === 'granted') {
        new Notification('🔥 Test Local FCM', {
            body: 'Esta es una notificación de prueba local',
            icon: '/favicon-192x192.png',
            badge: '/favicon-96x96.png'
        });
        console.log('✅ Notificación local enviada');
    } else if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            new Notification('🔥 Test Local FCM', {
                body: 'Permiso concedido - Esta es una notificación de prueba',
                icon: '/favicon-192x192.png',
                badge: '/favicon-96x96.png'
            });
            console.log('✅ Notificación local enviada tras conceder permiso');
        } else {
            console.log('❌ Permiso denegado');
        }
    } else {
        console.log('❌ Permisos de notificación denegados');
    }
};

console.log('🧪 Funciones de test disponibles:');
console.log('   - testFCMLocal() - Diagnóstico completo FCM');
console.log('   - testNotificationLocal() - Test de notificación local');

document.addEventListener('DOMContentLoaded', function() {
    // Auto-test básico al cargar
    setTimeout(() => {
        console.log('🧪 Auto-test al cargar página:');
        testFCMLocal();
    }, 2000);
});
