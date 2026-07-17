import matplotlib.pyplot as plt
import seaborn as sns
import numpy as np

def generate_heatmap():
    # Data extracted from new_evaluation_metrics.txt
    # Order: angry, disgust, fear, happy, neutral, sad, surprise
    cm = np.array([
        [661,   7,  75,  19,  65,  64,   7],
        [  1, 895,   0,   0,   0,   0,   2],
        [ 62,   1, 648,  18,  40,  95,  34],
        [ 17,   0,  16, 782,  48,  20,  15],
        [ 60,   3,  55,  45, 635,  93,   7],
        [ 72,   0, 118,  19,  97, 583,   9],
        [  8,   2,  39,  16,  15,   5, 813]
    ])

    classes = ['Angry', 'Disgust', 'Fear', 'Happy', 'Neutral', 'Sad', 'Surprise']

    # Set the visual style
    plt.figure(figsize=(12, 9))
    sns.set_theme(style="white")

    # Create the heatmap
    # annot=True adds the numbers, fmt='d' ensures they are integers
    ax = sns.heatmap(cm, annot=True, fmt='d', cmap='Blues', 
                    xticklabels=classes, yticklabels=classes,
                    cbar_kws={'label': 'Number of Samples'})

    # Add labels and title
    plt.title('Emotion Detection Confusion Matrix\n(ResNet-18 Accuracy: 79.81%)', fontsize=16, pad=20)
    plt.ylabel('Actual Emotion (Ground Truth)', fontsize=12)
    plt.xlabel('Predicted Emotion', fontsize=12)
    
    # Save the file
    plt.tight_layout()
    plt.savefig('confusion_matrix_heatmap.png', dpi=300)
    print("Heatmap saved as 'confusion_matrix_heatmap.png'")
    plt.show()

if __name__ == "__main__":
    generate_heatmap()