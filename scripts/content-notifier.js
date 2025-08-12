#!/usr/bin/env node
/**
 * Script para detectar nuevo contenido y enviar notificaciones push
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Importar el sistema de notificaciones push
const { sendNotificationToAll, loadSubscriptions } = require('./push-notifications');

// Configuración
const CONTENT_DIRS = [
  'content/podcast',
  'content/noticias', 
  'content/social'
];

const SCAN_CONFIG = {
  maxDepth: 3, // Limitar profundidad de escaneo
  maxFiles: 1000, // Limitar número de archivos
  batchSize: 50 // Procesar en lotes
};

const HASH_FILE = path.join(__dirname, '../data/content-hash.json');

// Función para obtener el hash de un archivo
function getFileHash(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return crypto.createHash('md5').update(content).digest('hex');
  } catch (error) {
    return null;
  }
}

// Función para escanear contenido y generar hashes con limitaciones de seguridad
function scanContent() {
  const contentHashes = {};
  let totalFiles = 0;
  
  CONTENT_DIRS.forEach(dir => {
    const fullPath = path.join(__dirname, '..', dir);
    
    if (!fs.existsSync(fullPath)) {
      console.log(`Directorio no encontrado: ${dir}`);
      return;
    }
    
    try {
      // Escaneo recursivo limitado
      const files = scanDirectoryLimited(fullPath, SCAN_CONFIG.maxDepth);
      
      // Limitar número total de archivos procesados
      if (totalFiles + files.length > SCAN_CONFIG.maxFiles) {
        console.warn(`⚠️  Límite de archivos alcanzado (${SCAN_CONFIG.maxFiles}). Algunos archivos no serán procesados.`);
        files.splice(SCAN_CONFIG.maxFiles - totalFiles);
      }
      
      files.forEach(file => {
        const filePath = path.join(fullPath, file);
        const hash = getFileHash(filePath);
        if (hash) {
          contentHashes[`${dir}/${file}`] = {
            hash,
            path: filePath,
            lastModified: fs.statSync(filePath).mtime.toISOString()
          };
          totalFiles++;
        }
      });
      
    } catch (error) {
      console.error(`Error escaneando directorio ${dir}:`, error);
    }
  });
  
  console.log(`📊 Total de archivos procesados: ${totalFiles}`);
  return contentHashes;
}

// Función para escaneo recursivo limitado
function scanDirectoryLimited(dirPath, maxDepth, currentDepth = 0) {
  if (currentDepth >= maxDepth) {
    return [];
  }
  
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    let files = [];
    
    for (const item of items) {
      if (item.isFile() && item.name.endsWith('.md') && !item.name.includes('_index.md')) {
        files.push(item.name);
      } else if (item.isDirectory() && currentDepth < maxDepth - 1) {
        const subFiles = scanDirectoryLimited(
          path.join(dirPath, item.name), 
          maxDepth, 
          currentDepth + 1
        );
        files = files.concat(subFiles.map(f => path.join(item.name, f)));
      }
    }
    
    return files;
  } catch (error) {
    console.error(`Error leyendo directorio ${dirPath}:`, error);
    return [];
  }
}

// Función para cargar hashes previos
function loadPreviousHashes() {
  try {
    if (fs.existsSync(HASH_FILE)) {
      return JSON.parse(fs.readFileSync(HASH_FILE, 'utf8'));
    }
  } catch (error) {
    console.error('Error cargando hashes previos:', error);
  }
  return {};
}

// Función para guardar hashes actuales
function saveCurrentHashes(hashes) {
  try {
    // Crear directorio data si no existe
    const dataDir = path.dirname(HASH_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    fs.writeFileSync(HASH_FILE, JSON.stringify(hashes, null, 2));
    return true;
  } catch (error) {
    console.error('Error guardando hashes:', error);
    return false;
  }
}

// Función para extraer metadatos de un archivo markdown
function extractMetadata(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    
    if (!frontmatterMatch) {
      return {};
    }
    
    const frontmatter = frontmatterMatch[1];
    const metadata = {};
    
    // Extraer título
    const titleMatch = frontmatter.match(/title:\s*["']?([^"'\n]+)["']?/);
    if (titleMatch) {
      metadata.title = titleMatch[1].trim();
    }
    
    // Extraer descripción
    const descMatch = frontmatter.match(/description:\s*["']?([^"'\n]+)["']?/);
    if (descMatch) {
      metadata.description = descMatch[1].trim();
    }
    
    // Determinar tipo de contenido con valor por defecto
    if (filePath.includes('/podcast/')) {
      metadata.type = 'podcast';
      metadata.emoji = '🎧';
    } else if (filePath.includes('/noticias/')) {
      metadata.type = 'noticia';
      metadata.emoji = '📰';
    } else if (filePath.includes('/social/')) {
      metadata.type = 'social';
      metadata.emoji = '📱';
    } else {
      // Valor por defecto para contenido no categorizado
      metadata.type = 'general';
      metadata.emoji = '📄';
    }
    
    // Generar URL
    const relativePath = filePath.replace(path.join(__dirname, '../content'), '');
    const urlPath = relativePath.replace(/\.md$/, '/').replace(/\\/g, '/');
    metadata.url = urlPath;
    
    return metadata;
  } catch (error) {
    console.error('Error extrayendo metadatos:', error);
    return {};
  }
}

// Función para detectar archivos nuevos o modificados
function detectChanges() {
  const currentHashes = scanContent();
  const previousHashes = loadPreviousHashes();
  
  const changes = {
    new: [],
    modified: [],
    all: []
  };
  
  Object.entries(currentHashes).forEach(([filePath, current]) => {
    const previous = previousHashes[filePath];
    
    if (!previous) {
      // Archivo nuevo
      const metadata = extractMetadata(current.path);
      const change = {
        type: 'new',
        file: filePath,
        path: current.path,
        ...metadata
      };
      changes.new.push(change);
      changes.all.push(change);
    } else if (previous.hash !== current.hash) {
      // Archivo modificado
      const metadata = extractMetadata(current.path);
      const change = {
        type: 'modified',
        file: filePath,
        path: current.path,
        ...metadata
      };
      changes.modified.push(change);
      changes.all.push(change);
    }
  });
  
  return { changes, currentHashes };
}

// Función para enviar notificaciones por tipo de contenido
async function sendNotificationsForChanges(changes) {
  const subscriptions = loadSubscriptions();
  
  if (subscriptions.length === 0) {
    console.log('No hay suscriptores para notificaciones');
    return;
  }
  
  console.log(`Enviando notificaciones a ${subscriptions.length} suscriptores`);
  
  for (const change of changes.all) {
    let title = '';
    let body = '';
    
    switch (change.type) {
      case 'podcast':
        title = `${change.emoji} Nuevo episodio disponible`;
        body = change.title || 'Nuevo episodio del podcast Mundo Dolphins';
        break;
      case 'noticia':
        title = `${change.emoji} Nueva noticia`;
        body = change.title || 'Nueva noticia en Mundo Dolphins';
        break;
      case 'social':
        title = `${change.emoji} Nuevo contenido social`;
        body = change.title || 'Nuevo contenido en nuestras redes sociales';
        break;
      default:
        title = '🐬 Nuevo contenido';
        body = change.title || 'Nuevo contenido disponible en Mundo Dolphins';
    }
    
    try {
      await sendNotificationToAll(title, body, change.url);
      console.log(`✅ Notificación enviada: ${title}`);
      
      // Pequeña pausa entre notificaciones para evitar rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`❌ Error enviando notificación para ${change.file}:`, error);
    }
  }
}

// Función principal
async function main() {
  console.log('🔍 Detectando cambios en el contenido...');
  
  const { changes, currentHashes } = detectChanges();
  
  console.log(`📊 Resumen de cambios:`);
  console.log(`   - Archivos nuevos: ${changes.new.length}`);
  console.log(`   - Archivos modificados: ${changes.modified.length}`);
  console.log(`   - Total cambios: ${changes.all.length}`);
  
  if (changes.all.length > 0) {
    console.log('\n📝 Detalles de cambios:');
    changes.all.forEach(change => {
      console.log(`   ${change.emoji} ${change.type.toUpperCase()}: ${change.title || change.file}`);
    });
    
    // Solo enviar notificaciones para contenido nuevo (no modificaciones)
    // Filtro mejorado: asegurar que el contenido tiene un tipo válido y es notificable
    const newContent = changes.new.filter(c => {
      // Verificar que tiene tipo definido
      if (!c.type) {
        console.log(`⚠️  Contenido sin tipo ignorado: ${c.file}`);
        return false;
      }
      
      // Solo permitir tipos específicos para notificaciones
      const notifiableTypes = ['podcast', 'noticia'];
      
      if (!notifiableTypes.includes(c.type)) {
        console.log(`ℹ️  Contenido tipo '${c.type}' no genera notificaciones: ${c.file}`);
        return false;
      }
      
      return true;
    });
    
    if (newContent.length > 0) {
      console.log(`\n🔔 Enviando notificaciones para ${newContent.length} contenido nuevo...`);
      await sendNotificationsForChanges({ all: newContent });
    } else {
      console.log('\n⏭️  No hay contenido nuevo que requiera notificaciones');
    }
  } else {
    console.log('\n✅ No se detectaron cambios en el contenido');
  }
  
  // Guardar hashes actuales
  if (saveCurrentHashes(currentHashes)) {
    console.log('💾 Hashes guardados exitosamente');
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Error en la detección de contenido:', error);
    process.exit(1);
  });
}

module.exports = {
  detectChanges,
  sendNotificationsForChanges,
  scanContent,
  extractMetadata
};
