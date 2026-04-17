import pandas as pd
import re
from collections import defaultdict
import csv
import json

def extract_topics_subtopics_from_pdf_data():
    """
    Extract topics and subtopics from electronics product data
    """
    # Define your topic categories and their associated keywords
    topic_categories = {
        'Microcontrollers': ['arduino', 'esp', 'nodemcu', 'microcontroller', 'mcu', '8051', 'pic', 'avr', 'arm', 'atmega', 'atmel', 'stm32'],
        'Development Boards': ['development board', 'dev board', 'evaluation board', 'evk'],
        'Raspberry Pi': ['raspberry pi', 'rpi', 'pi zero', 'pi 4', 'pi 3'],
        'Sensors': ['sensor', 'detector', 'transducer'],
        'PCB & Fabrication': ['pcb', 'printed circuit board', 'circuit board', 'fabrication'],
        'Connectors': ['connector', 'terminal', 'header', 'jack', 'socket', 'plug'],
        'Passive Components': ['resistor', 'capacitor', 'inductor', 'transformer', 'potentiometer', 'varistor', 'thermistor'],
        'Active Components': ['diode', 'transistor', 'mosfet', 'igbt', 'thyristor', 'integrated circuit', 'ic'],
        'Power Supply': ['power supply', 'power adapter', 'adaptor', 'battery', 'charger', 'smps'],
        'LED & Lighting': ['led', 'light', 'lighting', 'lamp', 'bulb', 'indicator'],
        'Communication Modules': ['bluetooth', 'wifi', 'wireless', 'rf', 'gsm', 'gps', 'rfid', 'nfc', 'zigbee', 'lora'],
        'Motors & Drivers': ['motor', 'servo', 'stepper', 'driver'],
        'Displays': ['display', 'lcd', 'oled', 'tft', 'screen', 'monitor'],
        'Relays & Switching': ['relay', 'switch', 'switching', 'contactor'],
        'Tools & Equipment': ['tool', 'tester', 'meter', 'multimeter', 'oscilloscope', 'soldering'],
        'Cables & Wires': ['cable', 'wire', 'cord', 'jumper'],
        'Audio & Video': ['audio', 'video', 'speaker', 'microphone', 'camera', 'hdmi', 'vga', 'converter'],
    }
    
    # This function processes product data
    def process_product_data(product_list):
        # Dictionary to store topics and their subtopics
        topic_to_subtopics = defaultdict(set)
        
        # Track categorized and uncategorized products
        categorized_products = set()
        uncategorized_products = set()
        
        # Process each product
        for product in product_list:
            if not product or product.strip() == '':
                continue
                
            product = product.strip()
            product_lower = product.lower()
            
            # Flag to track if product has been categorized
            categorized = False
            
            # First pass: Try to match exact topics/subtopics using delimiters
            if ' & ' in product:
                parts = product.split(' & ')
                topic = parts[0].strip()
                subtopic = ' & '.join(parts[1:]).strip()
                topic_to_subtopics[topic].add(product)
                categorized_products.add(product)
                categorized = True
                continue
                
            if ' - ' in product:
                parts = product.split(' - ')
                topic = parts[0].strip()
                subtopic = ' - '.join(parts[1:]).strip()
                topic_to_subtopics[topic].add(product)
                categorized_products.add(product)
                categorized = True
                continue
            
            # Second pass: Match using predefined categories
            for topic, keywords in topic_categories.items():
                for keyword in keywords:
                    if keyword in product_lower:
                        topic_to_subtopics[topic].add(product)
                        categorized_products.add(product)
                        categorized = True
                        break
                if categorized:
                    break
            
            # Third pass: Pattern-based matching for special cases
            if not categorized:
                # Handle Arduino products
                if 'arduino' in product_lower:
                    topic_to_subtopics['Microcontrollers'].add(product)
                    categorized_products.add(product)
                    categorized = True
                # Handle Raspberry Pi products
                elif 'raspberry' in product_lower or 'pi ' in product_lower:
                    topic_to_subtopics['Raspberry Pi'].add(product)
                    categorized_products.add(product)
                    categorized = True
                # Handle sensor products
                elif any(sensor_term in product_lower for sensor_term in ['sensor', 'detector', 'temperature', 'humidity', 'pressure', 'light', 'proximity']):
                    topic_to_subtopics['Sensors'].add(product)
                    categorized_products.add(product)
                    categorized = True
                # Handle display products
                elif any(display_term in product_lower for display_term in ['display', 'lcd', 'oled', 'tft', 'screen']):
                    topic_to_subtopics['Displays'].add(product)
                    categorized_products.add(product)
                    categorized = True
                # Add more pattern matching rules as needed
                
            # If still not categorized, add to uncategorized list
            if not categorized:
                uncategorized_products.add(product)
        
        # Try to assign uncategorized products based on common patterns
        remaining_uncategorized = set()
        for product in uncategorized_products:
            product_lower = product.lower()
            
            # Match by common product patterns
            if any(connector_term in product_lower for connector_term in ['connector', 'jack', 'plug', 'socket', 'terminal']):
                topic_to_subtopics['Connectors'].add(product)
                categorized_products.add(product)
            elif any(component_term in product_lower for component_term in ['resistor', 'capacitor', 'inductor']):
                topic_to_subtopics['Passive Components'].add(product)
                categorized_products.add(product)
            elif any(ic_term in product_lower for ic_term in ['ic', 'chip', 'integrated']):
                topic_to_subtopics['Active Components'].add(product)
                categorized_products.add(product)
            elif any(module_term in product_lower for module_term in ['module', 'shield', 'board']):
                topic_to_subtopics['Development Boards'].add(product)
                categorized_products.add(product)
            else:
                remaining_uncategorized.add(product)
        
        # Add remaining uncategorized products to a special category
        if remaining_uncategorized:
            topic_to_subtopics['Other/Miscellaneous'] = remaining_uncategorized
            
        return topic_to_subtopics, categorized_products, remaining_uncategorized

    # Sample product data from the PDF
    # This would normally be extracted from the PDF directly
    product_data = [
        "Test & Measurement", "Biomedical & Life Science", "Other Academic Products",
        "Development Boards", "Printed Circuit Board", "Remote Monitoring System",
        "Single Sided Pcb", "Metal Core Pcb", "Pcb Designing & Manufacturing",
        "Double Sided Pcb", "Pcb Design Sevice", "Pcb Fabrication",
        "3d printing", "Pcb Drilling And Routing Machine", "Connectors",
        "Electronic Connectors", "Electro Component", "PCB Connectors",
        "Infineon Modules", "Logitech", "Logitech keyboard", "Logitech Wireless Mouse",
        "Logitech Webcam", "Logitech Cam Connect", "Logitech USB bolt",
        "Pcb Mount Terminal Block", "Lithium Ion Battery Accessories", "Rs232 Converter",
        "Infrared Temperature Sensors", "Usb Fingerprint Reader", "Lithium Polymer Battery",
        "Passive Components", "Mini Din Connector", "Wireless And Wired Mouse",
        "Banana Connector", "Dc Pin", "Plc Battery", "Arduino Nano Board",
        "Rechargeable battery", "D- Sub Connector", "Wireless Presenter",
        "Electric Fuses", "Wifi Wlan Modules", "Power Sockets", "LCD Display",
        "Dish Tv Adapter", "Ceramic Electrical Connector", "Rmc Relimate Connector",
        "Smd Tantalum Capacitors", "Sim Card Holder", "GPS Modules 57 Channel",
        "Relay Channel Boards", "Battery cells", "Arduino Uno", "Wireless Mouse",
        "Presenter", "Temperature Sensor", "Power Modules", "Switching Regulators",
        "Dc Plugs", "Fire Alarm System", "Crystal Oscillators", "Metal Pendrive",
        "Wire To Wire Connector", "Usb And Micro Jack Connector", "Crimping Pin",
        "Gas Discharge Tube", "Active Component", "Bluetooth Switching Controller Module",
        "Rotary Cam Switch", "GPS Modules", "Glass Axial Fuse", "Thermal Fuses",
        "Delay Time model", "Rf Transmitter And Receiver", "Smd Power Inductor",
        "Diode Rectifier", "Frc Female Connector For Electronic Industry", "Vibration Sensor",
        "Plastic Electrical Wire Connector", "Thermal Fuse", "Rfid Cards 125 Khz",
        "LED Panel Indicator", "Emergency Stop Switches", "Onlive Vibration Sensor",
        "Logic Ics Cmos Series", "Zener Diode", "Schottky Diodes", "Cooling fan",
        "Safety Fuse", "Rfid 4 Port Reader", "Resettable & Non Resettable Fuse",
        "Radial Fuses", "Automotive Fuses And Fuse Holders", "Power Switches",
        "Right Angled Adapters", "Led Dimmimg Lamp", "Eruo connector", "Fanuc Miniature Fuse",
        "Fuse Connecting Wire", "Timer Module", "E3fa-rp21 Omron Photoelectric Sensor",
        "Electronic Fuses", "Ptc Resettable Fuse", "Sim Connector", "Mx Vga Cable",
        "Smd Switches",
        # Microcontroller boards
        "ESP 8266 NODE MCU", "ESP 32 WiFi Module", "NODE MCU WiFi Module", "Wifi Modules",
        "Arduino USB Evaluation Module", "Arduino Zero Electronic Development Board",
        "8095 Electronic Development Board", "TFT Arduino Display", "Arduino Zero",
        "Arduino Uno R3 Smd With Usb Cable", "Lm298n Motor Driver", "Arduino Micro",
        "Arduino Portenta H7 Development Board",
        # Sensors
        "Gas Sensor Module", "MQ4 Methane Gas Sensor", "Bluetooth Serial Modules",
        "Digital RFID Reader", "Servo Motor MG995", "3 Phase Servo Motor", "Robot Motor Wheel",
        "Coreless Motor", "Dyfenco Solder Paste", "Dyfenco Liquid Flux", "Electric DC Motor",
        "Battery Charging Module", "GPS Internal Antenna", "Arduino wifi shield",
        "Arduino USB host shield", "Audio Cables Connector", "SIM800A GPS Module",
        "Dyfenco Soldering Wire", "Scientific SM7023 Digital Multimeter",
        "3 V Infrared LED", "Tricycle Robotic Machine", "Motor Driver Shield",
        "Ebmpapst Coolent Fan", "Micro Drone Propeller", "Metal Detector Sensor",
        "TFT LCD Screen Module", "SMPS Module", "Dynamic Signal Analyser",
        "Hot Dip Soldering Bar",
        # Raspberry Pi
        "Raspberry Pi Zero", "Raspberry Pi 3", "Raspberry Pi 4", "Raspberry PI 5 - 8GB",
        "Raspberry Pi Camera", "Raspberry Pi Keyboard", "Raspberry Pi Mouse",
        "Raspberry Pi Aluminum Heatsink", "Raspberry PI 4B Acrylic Case",
        "Raspberry PI POE Add-on Board", "Raspberry PI Microcontroller", "E-Ink Paper Display Module"
    ]
    
    # Process the data
    topic_to_subtopics, categorized_products, uncategorized_products = process_product_data(product_data)
    
    # Create a structured result
    result = []
    for topic, subtopics in topic_to_subtopics.items():
        result.append({
            "topic": topic,
            "subtopics": sorted(list(subtopics))
        })
    
    # Sort by topic name
    result.sort(key=lambda x: x["topic"])
    
    # Print statistics
    print(f"Total products: {len(product_data)}")
    print(f"Categorized: {len(categorized_products)}")
    print(f"Uncategorized: {len(uncategorized_products)}")
    print(f"Topics: {len(topic_to_subtopics)}")
    
    # Export to CSV
    with open('electronics_topics_subtopics.csv', 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(["Topic", "Subtopic"])
        for item in result:
            topic = item["topic"]
            for subtopic in item["subtopics"]:
                writer.writerow([topic, subtopic])
    
    # Export to JSON for easier programmatic access
    with open('electronics_topics_subtopics.json', 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2)
    
    print("Results exported to CSV and JSON files")
    
    return result

def print_topics_hierarchy(topics_data):
    """Print the topics and subtopics in a hierarchical format"""
    for topic_data in topics_data:
        topic = topic_data["topic"]
        subtopics = topic_data["subtopics"]
        
        print(f"\n{topic} ({len(subtopics)} products)")
        print("-" * 60)
        for i, subtopic in enumerate(subtopics, 1):
            print(f"  {i}. {subtopic}")

# Main execution
if __name__ == "__main__":
    topics_data = extract_topics_subtopics_from_pdf_data()
    print_topics_hierarchy(topics_data)

    # Example of how to use this data in another program
    print("\nExample of accessing data programmatically:")
    print("First topic:", topics_data[0]["topic"])
    print("Number of subtopics:", len(topics_data[0]["subtopics"]))
    print("First subtopic:", topics_data[0]["subtopics"][0])