const Product = require('../model/Product');
const cloudinary = require('cloudinary').v2;



const getProducts =  async(req, res) =>{
    try{
        const products = await Product.find({});
        res.json(products);

    }
    catch(err){
        res.status(500).json({message: 'Server error'});

    }
}


const getProductById = async(req, res) =>{
    try{
       const product =  await Product.findById(req.params.id);
       if(product){
        res.json(product);
       }
       else{
        res.status(404).json({message : 'Product not Found'});

       }

    }
    catch(err){
        res.status(500).json({message: 'Server error'});
    }
};

const createProduct = async(req, res) =>{
    try{
        const{name, description, price, category, stock} = req.body;
        let imageUrl ='';
        if(req.file){
            const result = await cloudinary.uploader.upload(req.file.path);
            imageUrl = result.secure_url;
        }

        const product = new Product({
            name, 
            description,
            price,
            category,
            stock,
            imageUrl

        });

        const saveProduct = await product.save();
        res.status(201).json(saveProduct);


    }
    catch(err){
       console.error("Create Product Error:", err);
  res.status(500).json({ message: err.message });
    }
};



const updateProduct = async (req, res) => {
  try {
    const { name, description, price, category, stock } = req.body;

    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (name !== undefined) product.name = name;
    if (description !== undefined) product.description = description;
    if (price !== undefined) product.price = price;
    if (category !== undefined) product.category = category;
    if (stock !== undefined) product.stock = stock;

    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path);
      product.imageUrl = result.secure_url;
    }

    const updatedProduct = await product.save();
    res.json(updatedProduct);
  } catch (err) {
    console.error("Update Product Error:", err);
    res.status(500).json({ message: err.message });
  }
};

const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    await product.deleteOne();
    res.json({ message: "Product removed" });
  } catch (err) {
    console.error("Delete Product Error:", err);
    res.status(500).json({ message: err.message });
  }
};


module.exports ={getProducts, getProductById, createProduct, updateProduct, deleteProduct}



