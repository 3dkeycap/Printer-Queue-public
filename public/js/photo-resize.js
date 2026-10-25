/*
 * Réduit une photo (700 px, JPEG) avant de l'envoyer à l'app : utilisé par le champ photo des réglages
 * d'inventaire et par la page « ajouter depuis le téléphone ».
 */
const MAX_SIDE = 700;

// FileReader (data URL) plutôt qu'une adresse blob: : la politique de sécurité de l'app n'autorise que 'self' et data:
export const resizePhoto = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Image illisible'));
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      image.onerror = () => reject(new Error('Image illisible'));
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

