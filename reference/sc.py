import os
import cv2

# Настройки
INPUT_DIR = '.'  # Текущая папка
OUTPUT_DIR = 'ocr_ready'
MAX_SIDE = 3000  # Максимальный размер стороны (ширины или высоты) в пикселях

os.makedirs(OUTPUT_DIR, exist_ok=True)

# Список поддерживаемых расширений
valid_extensions = ('.jpg', '.jpeg', '.png', '.webp', '.bmp')

files = [f for f in os.listdir(INPUT_DIR) if f.lower().endswith(valid_extensions)]

print(f"Найдено файлов для обработки: {len(files)}")

for filename in files:
    img_path = os.path.join(INPUT_DIR, filename)
    img = cv2.imread(img_path)
    
    if img is None:
        continue
        
    h, w = img.shape[:2]
    
    # 1. Сжатие геометрии (Resize), если фото слишком большое
    if max(h, w) > MAX_SIDE:
        scale = MAX_SIDE / max(h, w)
        new_w = int(w * scale)
        new_h = int(h * scale)
        # INTER_AREA — идеальный метод для уменьшения картинок, не мылит текст
        img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
    
    # 2. Перевод в оттенки серого
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # 3. Размытие для удаления мелкого "песка" и шумов матрицы
    blurred = cv2.medianBlur(gray, 5)
    
    # 4. Адаптивный монохром
    binary = cv2.adaptiveThreshold(
        blurred, 
        255, 
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
        cv2.THRESH_BINARY, 
        31, 
        10
    )
    
    # 5. Сохранение в PNG с максимальным уровнем сжатия без потери качества
    name_without_ext = os.path.splitext(filename)[0]
    output_path = os.path.join(OUTPUT_DIR, f"{name_without_ext}.png")
    
    # Параметр [cv2.IMWRITE_PNG_COMPRESSION, 9] включает максимальное сжатие файла
    cv2.imwrite(output_path, binary, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    
    print(f"Обработан: {filename} -> {name_without_ext}.png")

print("\nВся папка успешно обработана и сжата в PNG!")
